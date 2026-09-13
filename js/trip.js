// 여행 칸의 '내 여행' 화면: 여행 목록·상세·만들기.
// 여행 하나 = 어디(지역 여러 개) + 언제(기간). 이름은 안 적으면 "제주시 3" 처럼 지역으로 짓는다.
// 상세는 트리플처럼 위에서 아래로 — 며칠째 → 준비물 체크 → 일차별 일정.
// 일정 줄에 적은 금액은 가계부 거래로 따라 들어간다 (save_trip_plan RPC 가 한 번에 쓴다).
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic } from './ui.js';
import { VIEWBOX, REGIONS } from './koreamap.js';
import { fetchCategories } from './categories.js';
import {
  todayLocal, formatWon, parseWon, dayName, tripLabel, tripNights, tripStatus, sortTrips, tripsByRegion,
  nextTripName, tripDates, groupPlansByDate, sumPlans,
} from './calc.js';
import * as packing from './packing.js';

const [, , MAPW, MAPH] = VIEWBOX.split(' ').map(Number);
const BY_CODE = new Map(REGIONS.map((r) => [r.c, r]));

const state = {
  trips: [],
  byRegion: new Map(),
  userId: null,
  editing: null,   // 시트에서 고치는 중인 여행 (새 여행이면 null)
  picked: [],      // 시트에서 고른 지역 [{ code, name }]
  viewing: null,   // 상세로 열어 둔 여행 id
  packed: new Set(),  // 그 여행에서 챙긴 준비물 id
  plans: [],          // 그 여행의 일정 줄
  plan: null,         // 시트에서 고치는 중인 일정 줄
  planDate: '',       // 시트에서 고른 날
};

let el = null;
let initialized = false;
let onChange = () => {};      // 여행이 바뀌면 지도도 다시 그리게
let onTxChange = () => {};    // 일정 금액이 가계부를 건드렸을 때
let onShowRange = () => {};   // 가계부에서 이 기간 보기
let onGo = () => {};          // 다른 화면으로 (준비물 목록)

export function init({ userId, onChange: changed, onTxChange: txChanged, onShowRange: showRange, onGo: go }) {
  state.userId = userId;
  if (changed) onChange = changed;
  if (txChanged) onTxChange = txChanged;
  if (showRange) onShowRange = showRange;
  if (go) onGo = go;
  if (initialized) return;
  initialized = true;

  el = {
    upcoming: $('#trip-upcoming'),
    past: $('#trip-past'),
    empty: $('#trip-empty'),
    sheet: $('#sheet-trip'),
    form: $('#trip-form'),
    id: $('#trip-id'),
    title: $('#trip-title'),
    start: $('#trip-start'),
    end: $('#trip-end'),
    span: $('#trip-span'),
    regions: $('#trip-regions'),
    pick: $('#trip-region-pick'),
    search: $('#trip-region-search'),
    results: $('#trip-region-results'),
    memo: $('#trip-memo'),
    save: $('#trip-save'),
    del: $('#trip-delete'),
    view: $('#view-trip'),
    viewTitle: $('#trip-view-title'),
    body: $('#trip-body'),
    planSheet: $('#sheet-plan'),
    planForm: $('#plan-form'),
    planId: $('#plan-id'),
    planDays: $('#plan-days'),
    planPlace: $('#plan-place'),
    planAmount: $('#plan-amount'),
    planMemo: $('#plan-memo'),
    planSave: $('#plan-save'),
    planDel: $('#plan-delete'),
  };

  bindSheetBackdrop(el.sheet);
  bindSheetBackdrop(el.planSheet);

  for (const box of [el.upcoming, el.past]) {
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) return refresh();
      const card = e.target.closest('.trip-card');
      if (card) openTrip(Number(card.dataset.id));
    });
  }

  // 여행 시트
  el.title.addEventListener('input', validate);
  el.start.addEventListener('change', () => {
    if (!el.end.value || el.end.value < el.start.value) el.end.value = el.start.value;
    validate();
  });
  el.end.addEventListener('change', validate);
  el.regions.addEventListener('click', onRegionChipClick);
  el.search.addEventListener('input', renderResults);
  el.results.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-code]');
    if (!chip) return;
    addRegion(chip.dataset.code);
    el.search.value = '';
    renderResults();
  });
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  el.del.addEventListener('click', () => remove());

  // 일정 시트
  el.planDays.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-date]');
    if (!chip) return;
    state.planDate = chip.dataset.date;
    renderPlanDays();
  });
  el.planPlace.addEventListener('input', validatePlan);
  el.planAmount.addEventListener('input', () => {
    const n = parseWon(el.planAmount.value);
    el.planAmount.value = n ? formatWon(n) : '';
    validatePlan();
  });
  el.planForm.addEventListener('submit', (e) => {
    e.preventDefault();
    savePlan();
  });
  el.planDel.addEventListener('click', removePlan);

  // 상세
  $('#trip-close').addEventListener('click', closeDetail);
  $('#trip-edit').addEventListener('click', () => {
    const trip = current();
    if (trip) openSheetFor(trip);
  });
  el.body.addEventListener('click', onDetailClick);
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

// 아직 SQL 을 실행하지 않아 표가 없는 상태인지.
function missingTable(err) {
  const m = `${err?.message ?? ''} ${err?.code ?? ''}`;
  return /does not exist|could not find the table|42P01|PGRST205|function .* does not exist/i.test(m);
}

function current() {
  return state.trips.find((t) => t.id === state.viewing) ?? null;
}

// ---- 지도에서 쓰는 것 --------------------------------------------------------

export function tripsIn(code) {
  return state.byRegion.get(code) ?? [];
}

export function regionCodes() {
  return new Set(state.byRegion.keys());
}

// ---- 조회 ------------------------------------------------------------------

export async function refresh() {
  if (!initialized) return;
  try {
    const trips = unwrap(
      await sb.from('trips').select('*, regions:trip_regions(code,name)').order('start_date', { ascending: false }),
    );
    state.trips = trips;
    state.byRegion = tripsByRegion(trips);
    render();
    if (!el.view.hidden && state.viewing) {
      if (!current()) closeDetail();     // 상대가 지운 여행
      else await showDetail();
    }
    onChange();
  } catch (err) {
    console.error(err);
    el.empty.hidden = true;
    el.past.innerHTML = '';
    el.upcoming.innerHTML = missingTable(err)
      ? `<p class="empty">여행 표가 아직 없어요.<br>Supabase SQL Editor 에서<br><code>schema.sql</code> 의 29·31번 섹션을 실행해 주세요.</p>`
      : `<div class="retry">불러오지 못했어요<br>
          <button type="button" class="btn small" data-retry>다시 시도</button>
        </div>`;
  }
}

// 준비물 목록이 바뀌면 열려 있는 상세도 다시 그린다.
export function rerender() {
  if (!el.view.hidden && state.viewing) renderDetail();
}

// ---- 목록 ------------------------------------------------------------------

function render() {
  const today = todayLocal();
  const { upcoming, past } = sortTrips(state.trips, today);
  el.empty.hidden = state.trips.length > 0;
  el.upcoming.innerHTML = upcoming.length
    ? `<h2 class="list-head">다가오는 여행 <span class="count">${upcoming.length}</span></h2>${upcoming.map((t, i) => card(t, today, i)).join('')}`
    : '';
  el.past.innerHTML = past.length
    ? `<h2 class="list-head">지난 여행 <span class="count">${past.length}</span></h2>${past.map((t, i) => card(t, today, i)).join('')}`
    : '';
}

function where(trip) {
  const list = (trip.regions ?? []).map((r) => r.name || r.code);
  return list.length ? list.join(' · ') : '지역 없음';
}

function card(trip, today, i = 0) {
  const st = tripStatus(trip, today);
  return `
    <div class="card trip-card" data-id="${trip.id}" style="--i:${Math.min(i, 12)}">
      <div class="trip-main">
        <div class="trip-title">${escapeHtml(trip.title)}</div>
        <div class="trip-where">${escapeHtml(where(trip))}</div>
        <div class="trip-when">${tripLabel(trip.start_date, trip.end_date)}</div>
      </div>
      <div class="trip-dday ${st.state}">${st.text}</div>
    </div>`;
}

// ---- 상세 ------------------------------------------------------------------

export async function openTrip(id) {
  const trip = state.trips.find((t) => t.id === id);
  if (!trip) return;
  state.viewing = id;
  state.packed = new Set();
  state.plans = [];
  el.viewTitle.textContent = trip.title;
  el.view.hidden = false;
  renderDetail();      // 뼈대 먼저
  await showDetail();
}

export function closeDetail() {
  el.view.hidden = true;
  state.viewing = null;
}

async function showDetail() {
  const trip = current();
  if (!trip) return;
  try {
    const [packed, plans] = await Promise.all([
      sb.from('trip_packed').select('item_id').eq('trip_id', trip.id).then(unwrap),
      sb.from('trip_plans').select('*').eq('trip_id', trip.id).order('created_at', { ascending: true }).then(unwrap),
    ]);
    state.packed = new Set(packed.map((r) => r.item_id));
    state.plans = plans;
  } catch (err) {
    console.error(err);
    if (missingTable(err)) toast('준비물·일정 표가 아직 없어요. schema.sql 31번을 실행해 주세요');
  }
  el.viewTitle.textContent = trip.title;
  renderDetail();
}

// 여행 지역 언저리만 잘라 보여 주는 작은 지도. "여기가 어디쯤" 만 알면 된다.
function miniMap(trip) {
  const mine = (trip.regions ?? []).map((r) => BY_CODE.get(r.code)).filter(Boolean);
  if (!mine.length) return '';
  const x0 = Math.min(...mine.map((r) => r.b[0]));
  const y0 = Math.min(...mine.map((r) => r.b[1]));
  const x1 = Math.max(...mine.map((r) => r.b[0] + r.b[2]));
  const y1 = Math.max(...mine.map((r) => r.b[1] + r.b[3]));
  const ratio = 16 / 10;

  // 지역만 딱 맞추면 어디인지 알 수 없다. 둘레를 넉넉히 두고, 너무 멀지도 가깝지도 않게 자른다.
  let w = Math.min(Math.max(Math.max(x1 - x0, (y1 - y0) * ratio) * 2.6, 560), MAPW);
  let h = w / ratio;
  if (h > MAPH) {
    h = MAPH;
    w = h * ratio;
  }
  // 지도 밖으로 나가도 그냥 둔다 — 여백은 바다처럼 보이고, 여행지가 늘 한가운데 온다.
  const vx = (x0 + x1) / 2 - w / 2;
  const vy = (y0 + y1) / 2 - h / 2;

  const near = REGIONS.filter(
    (r) => r.b[0] < vx + w && r.b[0] + r.b[2] > vx && r.b[1] < vy + h && r.b[1] + r.b[3] > vy,
  );
  const codes = new Set(mine.map((r) => r.c));
  return `
    <svg class="mini-map" viewBox="${vx} ${vy} ${w} ${h}" role="img" aria-label="여행 지역 지도">
      ${near.map((r) => `<path class="${codes.has(r.c) ? 'on' : ''}" d="${r.d}"/>`).join('')}
      ${mine
        .map(
          (r) =>
            `<text x="${r.p[0]}" y="${r.p[1]}" font-size="${Math.round(w / 24)}" stroke-width="${Math.round(w / 150)}">${escapeHtml(r.n)}</text>`,
        )
        .join('')}
    </svg>`;
}

function renderDetail() {
  const trip = current();
  if (!trip) return;
  const st = tripStatus(trip, todayLocal());

  el.body.innerHTML = `
    <section class="card trip-head ${st.state}">
      <div class="trip-dday ${st.state} big">${st.text}</div>
      <div class="trip-when">${tripLabel(trip.start_date, trip.end_date)}</div>
      <div class="chips read">${(trip.regions ?? [])
        .map((r) => `<span class="chip">${escapeHtml(r.name || r.code)}</span>`)
        .join('') || '<span class="hint">지역을 안 골랐어요</span>'}</div>
      ${miniMap(trip)}
      ${trip.memo ? `<p class="trip-memo">${escapeHtml(trip.memo)}</p>` : ''}
    </section>

    ${packingCard()}
    ${planCard(trip)}

    <button type="button" class="btn small wide" data-act="ledger">가계부에서 이 기간 보기</button>
    <button type="button" class="btn wide danger" data-act="remove">이 여행 삭제</button>`;
}

// 준비물: 공용 체크리스트를 그대로 가져와 체크만 한다.
function packingCard() {
  const list = packing.items();
  const done = list.filter((it) => state.packed.has(it.id)).length;
  return `
    <section class="card">
      <h2>준비물 ${list.length ? `<span class="count">${done}/${list.length}</span>` : ''}</h2>
      ${list.length
        ? list
            .map(
              (it) => `
        <div class="todo-row item-row ${state.packed.has(it.id) ? 'done' : ''}" data-item="${it.id}">
          <button type="button" class="todo-check" aria-label="${state.packed.has(it.id) ? '안 챙김' : '챙김'}">${state.packed.has(it.id) ? '✓' : ''}</button>
          <div class="todo-main"><div class="todo-title">${escapeHtml(it.title)}</div></div>
        </div>`,
            )
            .join('')
        : `<p class="hint">체크리스트가 비어 있어요.<br>여행 칸의 <b>준비물</b> 에서 늘 챙기는 것을 적어 두면 여행마다 여기에 그대로 나와요.</p>
           <button type="button" class="btn small" style="margin-top:10px" data-act="packing">준비물 적으러 가기</button>`}
    </section>`;
}

// 일정: 2박 3일이면 세 칸. 칸마다 어디를 갔고 얼마를 썼는지 줄을 더한다.
function planCard(trip) {
  const dates = tripDates(trip.start_date, trip.end_date);
  const byDate = groupPlansByDate(state.plans, dates);
  const total = sumPlans(state.plans);
  const today = todayLocal();

  const days = dates
    .map((date, i) => {
      const list = byDate.get(date) ?? [];
      const sum = sumPlans(list);
      const [, m, d] = date.split('-').map(Number);
      return `
      <div class="plan-day ${date === today ? 'today' : ''}">
        <div class="day-head">
          <span>${i + 1}일째 · ${m}/${d} (${dayName(date)})${date === today ? ' · 오늘' : ''}</span>
          <span class="sub">${sum ? formatWon(sum) : ''}</span>
        </div>
        ${list.map((p) => planRow(p)).join('')}
        <button type="button" class="plan-add" data-add="${date}">＋ 일정 추가</button>
      </div>`;
    })
    .join('');

  return `
    <section class="card plans">
      <h2>일정 ${total ? `<span class="count">${formatWon(total)}원</span>` : ''}</h2>
      ${days}
    </section>`;
}

function planRow(p) {
  return `
    <div class="tx-row plan-row" data-plan="${p.id}">
      <div class="tx-main">
        <div class="tx-cat">${escapeHtml(p.place || '메모')}</div>
        ${p.memo ? `<div class="tx-memo">${escapeHtml(p.memo)}</div>` : ''}
      </div>
      <div class="tx-amount">${p.amount ? formatWon(p.amount) : ''}</div>
    </div>`;
}

function onDetailClick(e) {
  const trip = current();
  if (!trip) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'ledger') {
    closeDetail();
    onShowRange(trip.start_date, trip.end_date);
    return;
  }
  if (act === 'remove') return remove(trip);
  if (act === 'packing') {
    closeDetail();
    onGo('packing');
    return;
  }

  const add = e.target.closest('[data-add]');
  if (add) return openPlan(null, add.dataset.add);

  const row = e.target.closest('[data-plan]');
  if (row) return openPlan(state.plans.find((p) => p.id === Number(row.dataset.plan)));

  const item = e.target.closest('[data-item]');
  if (item) togglePacked(Number(item.dataset.item));
}

// ---- 준비물 체크 -------------------------------------------------------------

async function togglePacked(itemId) {
  const trip = current();
  if (!trip) return;
  const on = !state.packed.has(itemId);
  if (on) state.packed.add(itemId);
  else state.packed.delete(itemId);
  renderDetail();
  haptic(on ? 15 : 5);
  try {
    if (on) unwrap(await sb.from('trip_packed').insert({ trip_id: trip.id, item_id: itemId }));
    else unwrap(await sb.from('trip_packed').delete().eq('trip_id', trip.id).eq('item_id', itemId));
  } catch (err) {
    console.error(err);
    if (on) state.packed.delete(itemId);
    else state.packed.add(itemId);
    renderDetail();
    toast('변경에 실패했어요. 다시 시도해 주세요');
  }
}

// ---- 일정 줄 시트 ------------------------------------------------------------

function openPlan(plan, date) {
  const trip = current();
  if (!trip) return;
  state.plan = plan ?? null;
  state.planDate = plan?.date ?? date ?? trip.start_date;

  el.planId.value = plan?.id ?? '';
  el.planPlace.value = plan?.place ?? '';
  el.planAmount.value = plan?.amount ? formatWon(plan.amount) : '';
  el.planMemo.value = plan?.memo ?? '';
  el.planDel.hidden = !plan;
  renderPlanDays();
  validatePlan();
  openSheet(el.planSheet);
  if (!plan) setTimeout(() => el.planPlace.focus(), 250);
}

function renderPlanDays() {
  const trip = current();
  if (!trip) return;
  const dates = tripDates(trip.start_date, trip.end_date);
  el.planDays.innerHTML = dates
    .map(
      (date, i) =>
        `<button type="button" class="chip ${date === state.planDate ? 'selected' : ''}" data-date="${date}">${i + 1}일째<small> ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}</small></button>`,
    )
    .join('');
}

function validatePlan() {
  el.planSave.disabled = !el.planPlace.value.trim() && parseWon(el.planAmount.value) <= 0;
}

// 가계부에서 이 지출이 들어갈 카테고리 ('여행' 이 없으면 미분류)
async function travelCategoryId() {
  try {
    const cats = await fetchCategories();
    return cats.find((c) => c.kind === 'expense' && c.name === '여행')?.id ?? null;
  } catch (err) {
    console.warn(err);
    return null;
  }
}

async function savePlan() {
  const trip = current();
  if (!trip) return;
  const place = el.planPlace.value.trim();
  const amount = parseWon(el.planAmount.value);
  if (!place && amount <= 0) return;

  el.planSave.disabled = true;
  try {
    unwrap(
      await sb.rpc('save_trip_plan', {
        p: {
          id: state.plan?.id ?? null,
          trip_id: trip.id,
          transaction_id: state.plan?.transaction_id ?? null,
          date: state.planDate,
          place,
          memo: el.planMemo.value.trim(),
          amount,
          category_id: amount > 0 ? await travelCategoryId() : null,
          tx_memo: `${trip.title}${place ? ` · ${place}` : ''}`,
        },
      }),
    );
    haptic();
    closeSheet(el.planSheet);
    await showDetail();
    if (amount > 0 || state.plan?.amount) onTxChange(); // 가계부도 바뀌었다
  } catch (err) {
    console.error(err);
    toast(missingTable(err) ? '일정 표가 아직 없어요. schema.sql 31번을 실행해 주세요' : '저장에 실패했어요. 다시 시도해 주세요');
  } finally {
    el.planSave.disabled = false;
  }
}

async function removePlan() {
  if (!state.plan) return;
  const msg = state.plan.amount
    ? `이 줄을 지우면 가계부의 ${formatWon(state.plan.amount)}원 지출도 함께 사라져요. 지울까요?`
    : '이 줄을 지울까요?';
  if (!confirmDialog(msg)) return;
  try {
    const had = state.plan.amount > 0;
    unwrap(await sb.from('trip_plans').delete().eq('id', state.plan.id));
    closeSheet(el.planSheet);
    await showDetail();
    if (had) onTxChange();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
}

// ---- 만들기·수정 시트 --------------------------------------------------------

// code 를 주면 그 지역이 미리 골라진다 (지도에서 만들 때).
export function openNew(code = null) {
  openSheetFor(null, code);
}

function openSheetFor(trip, code = null) {
  closeDetail();
  state.editing = trip ?? null;
  state.picked = trip
    ? (trip.regions ?? []).map((r) => ({ code: r.code, name: r.name || nameOf(r.code) }))
    : code
      ? [{ code, name: nameOf(code) }]
      : [];

  const today = todayLocal();
  el.id.value = trip?.id ?? '';
  el.title.value = trip?.title ?? '';
  el.start.value = trip?.start_date ?? today;
  el.end.value = trip?.end_date ?? today;
  el.memo.value = trip?.memo ?? '';
  el.del.hidden = !trip;
  el.pick.hidden = state.picked.length > 0;
  el.search.value = '';
  renderResults();
  renderPicked();
  openSheet(el.sheet);
  if (!trip && !state.picked.length) setTimeout(() => el.search.focus(), 250);
}

function nameOf(code) {
  return REGIONS.find((r) => r.c === code)?.n ?? code;
}

// 이름을 안 적었을 때 쓸 이름. "제주시" 를 두 번 갔으면 "제주시 3".
function autoName() {
  const first = state.picked[0];
  if (!first) return '여행';
  const been = tripsIn(first.code).filter((t) => t.id !== state.editing?.id).length;
  return nextTripName(first.name, been);
}

function renderPicked() {
  el.regions.innerHTML =
    state.picked
      .map((r) => `<button type="button" class="chip selected" data-drop="${r.code}">${escapeHtml(r.name)} ✕</button>`)
      .join('') + '<button type="button" class="chip add" data-add>＋ 지역</button>';
  el.title.placeholder = `${autoName()} (안 적어도 돼요)`;
  validate();
}

function onRegionChipClick(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  if (chip.dataset.add !== undefined) {
    el.pick.hidden = false;
    renderResults();
    el.search.focus();
    return;
  }
  state.picked = state.picked.filter((r) => r.code !== chip.dataset.drop);
  renderPicked();
}

function addRegion(code) {
  if (state.picked.some((r) => r.code === code)) return;
  state.picked.push({ code, name: nameOf(code) });
  renderPicked();
}

// 이름으로 지역 찾기. 아무것도 안 쳤으면 아직 안 고른 곳 몇 개만 보여 준다.
function renderResults() {
  const q = el.search.value.trim();
  const picked = new Set(state.picked.map((r) => r.code));
  const hit = REGIONS.filter((r) => !picked.has(r.c) && (!q || r.n.includes(q) || r.s.includes(q))).slice(0, 15);
  el.results.innerHTML = hit.length
    ? hit.map((r) => `<button type="button" class="chip" data-code="${r.c}">${escapeHtml(r.n)}<small> ${escapeHtml(r.s)}</small></button>`).join('')
    : '<span class="hint">그런 지역이 없어요</span>';
}

function validate() {
  const ok = state.picked.length > 0 && el.start.value && el.end.value && el.start.value <= el.end.value;
  el.save.disabled = !ok;
  el.span.textContent = el.start.value && el.end.value && el.start.value <= el.end.value
    ? tripLabel(el.start.value, el.end.value)
    : '';
}

async function save() {
  const payload = {
    title: el.title.value.trim() || autoName(),
    start_date: el.start.value,
    end_date: el.end.value,
    memo: el.memo.value.trim(),
  };
  if (!state.picked.length || payload.start_date > payload.end_date) return;
  el.save.disabled = true;
  try {
    let id = state.editing?.id;
    if (id) {
      unwrap(await sb.from('trips').update(payload).eq('id', id));
      unwrap(await sb.from('trip_regions').delete().eq('trip_id', id));
    } else {
      const row = unwrap(await sb.from('trips').insert({ ...payload, created_by: state.userId }).select('id').single());
      id = row.id;
    }
    unwrap(await sb.from('trip_regions').insert(state.picked.map((r) => ({ trip_id: id, code: r.code, name: r.name }))));
    haptic();
    closeSheet(el.sheet);
    await refresh();
    openTrip(id);
  } catch (err) {
    console.error(err);
    toast(missingTable(err) ? '여행 표가 아직 없어요. schema.sql 29번을 실행해 주세요' : '저장에 실패했어요. 다시 시도해 주세요');
  } finally {
    el.save.disabled = false;
  }
}

async function remove(trip = state.editing) {
  if (!trip) return;
  if (!confirmDialog(`"${trip.title}" 여행을 삭제할까요?\n일정에 적은 지출도 가계부에서 함께 사라져요.`)) return;
  try {
    unwrap(await sb.from('trips').delete().eq('id', trip.id));
    closeSheet(el.sheet);
    closeDetail();
    await refresh();
    onTxChange();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
}
