// 여행 칸의 '내 여행' 화면: 여행 목록·상세·만들기.
// 여행 하나 = 어디(지역 여러 개) + 언제(기간). 이름은 안 적으면 "제주시 3" 처럼 지역으로 짓는다.
// 상세는 트리플처럼 위에서 아래로 — 며칠째 → 준비물 체크 → 일차별 일정.
// 일정 줄에 적은 금액은 가계부 거래로 따라 들어간다 (save_trip_plan RPC 가 한 번에 쓴다).
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic } from './ui.js';
import { REGIONS } from './koreamap.js';
import { fetchCategories, addCategory } from './categories.js';
import {
  todayLocal, formatWon, parseWon, dayName, tripLabel, tripNights, tripStatus, sortTrips, tripsByRegion,
  nextTripName, tripDates, groupPlansByDate, splitPrep, sumPlans, sumCosts, groupPacking,
} from './calc.js';
import * as packing from './packing.js';

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
  planPrep: false,    // '여행 준비' 칸에 넣는 줄인지 (항공권·숙소처럼 미리 결제한 것)
  costs: [],          // 시트에서 고치는 중인 지출 줄 [{ id, category_id, amount, transaction_id }]
  dropped: [],        // 시트에서 뺀 지출 줄 id
  cats: [],           // 카테고리 전체 (일정 분류 + 가계부 '여행')
  rendered: '',       // 마지막으로 그린 내용 (같으면 다시 안 그린다 — 체크할 때 화면이 흔들리지 않게)
  packingOpen: null,  // 준비물 접기: null 이면 '여행 전에만 펼침', true/false 면 직접 접었다 편 것
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
    planWhen: $('#plan-when'),
    planDateInput: $('#plan-date'),
    planPlace: $('#plan-place'),
    planMemo: $('#plan-memo'),
    planCosts: $('#plan-costs'),
    planCostAdd: $('#plan-cost-add'),
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
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.prep !== undefined) {
      state.planPrep = true;
      state.planDate = prepDefaultDate();
    } else {
      state.planPrep = false;
      state.planDate = chip.dataset.date;
    }
    renderPlanDays();
  });
  el.planDateInput.addEventListener('change', () => {
    if (el.planDateInput.value) state.planDate = el.planDateInput.value;
  });
  el.planCosts.addEventListener('input', onCostInput);
  el.planCosts.addEventListener('change', onCostInput);
  el.planCosts.addEventListener('click', (e) => {
    const drop = e.target.closest('[data-drop]');
    if (!drop) return;
    const at = Number(drop.dataset.drop);
    const gone = state.costs[at];
    if (gone?.id) state.dropped.push(gone.id);
    state.costs.splice(at, 1);
    renderCosts();
  });
  el.planCostAdd.addEventListener('click', () => {
    state.costs.push({ id: null, category_id: defaultCatId(), amount: 0, transaction_id: null });
    renderCosts();
    el.planCosts.querySelector('.cost-row:last-child .cost-amount')?.focus();
  });
  el.planPlace.addEventListener('input', validatePlan);
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

// 아직 SQL 을 다 실행하지 않아 표나 열이 없는 상태인지 (열까지 봐야 한다 — 표만 있고 열이 빠진 경우가 있다).
function missingTable(err) {
  const m = `${err?.message ?? ''} ${err?.code ?? ''}`;
  return /does not exist|could not find the (table|function|column)|42P01|42703|PGRST20[0-9]/i.test(m);
}

const NEED_SQL = 'Supabase SQL Editor 에서 schema.sql 전체를 한 번 실행해 주세요';

// 무엇이 잘못됐는지 알아야 고친다 — 서버가 한 말과 코드를 그대로 보여 준다.
function errText(err) {
  return [err?.message, err?.code ? `(${err.code})` : ''].filter(Boolean).join(' ') || '다시 시도해 주세요';
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
      ? `<p class="empty">여행 표가 아직 없어요.<br>Supabase SQL Editor 에서<br><code>schema.sql</code> 전체를 한 번 실행해 주세요.</p>`
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
  state.packingOpen = null;
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
    const [packed, plans, cats] = await Promise.all([
      sb.from('trip_packed').select('item_id').eq('trip_id', trip.id).then(unwrap),
      sb
        .from('trip_plans')
        // '*' 로 받으면 열이 없어도 조용히 넘어간다. 이름을 적어 두면 SQL 을 덜 실행한 걸 여기서 알아챈다.
        .select('id,trip_id,date,place,memo,prep,created_at, costs:trip_costs(*)')
        .eq('trip_id', trip.id)
        .order('created_at', { ascending: true })
        .then(unwrap),
      fetchCategories(),
    ]);
    state.packed = new Set(packed.map((r) => r.item_id));
    state.plans = plans;
    state.cats = cats;
  } catch (err) {
    console.error(err);
    toast(missingTable(err) ? NEED_SQL : `불러오지 못했어요: ${errText(err)}`);
  }
  el.viewTitle.textContent = trip.title;
  if (signature() !== state.rendered) renderDetail();
}

// 지금 화면에 그려진 내용을 한 줄로. 이게 같으면 다시 그릴 이유가 없다.
function signature() {
  return JSON.stringify([
    current()?.id,
    current()?.title,
    [...state.packed].sort(),
    state.plans,
    packing.items().map((i) => [i.id, i.title, i.group_name, i.sort_order]),
  ]);
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
      ${trip.memo ? `<p class="trip-memo">${escapeHtml(trip.memo)}</p>` : ''}
    </section>

    ${packingCard(st)}
    ${planCard(trip)}

    <button type="button" class="btn small wide" data-act="ledger">가계부에서 이 기간 보기</button>
    <button type="button" class="btn wide danger" data-act="remove">이 여행 삭제</button>`;
  state.rendered = signature();
}

// 준비물: 공용 체크리스트를 그대로 가져와 체크만 한다.
// 떠나고 나면 더 볼 일이 없어서 여행이 시작되면 접어 둔다 (머리를 눌러 다시 편다).
function packingCard(st) {
  const list = packing.items();
  const done = list.filter((it) => state.packed.has(it.id)).length;
  const open = state.packingOpen ?? st.state === 'upcoming';
  return `
    <details class="card fold" id="packing-fold" ${open ? 'open' : ''}>
      <summary>준비물 ${list.length ? `<span class="count">${done}/${list.length}</span>` : ''}</summary>
      ${list.length
        ? groupPacking(list)
            .map(
              (g) => `
        <div class="group-head"><span>${escapeHtml(g.name)}</span><span class="sub">${g.items.filter((it) => state.packed.has(it.id)).length}/${g.items.length}</span></div>
        ${g.items
          .map(
            (it) => `
          <div class="todo-row item-row ${state.packed.has(it.id) ? 'done' : ''}" data-item="${it.id}">
            <button type="button" class="todo-check" aria-label="${state.packed.has(it.id) ? '안 챙김' : '챙김'}">${state.packed.has(it.id) ? '✓' : ''}</button>
            <div class="todo-main"><div class="todo-title">${escapeHtml(it.title)}</div></div>
          </div>`,
          )
          .join('')}`,
            )
            .join('')
        : `<p class="hint">체크리스트가 비어 있어요.<br>여행 칸의 <b>준비물</b> 에서 늘 챙기는 것을 적어 두면 여행마다 여기에 그대로 나와요.</p>
           <button type="button" class="btn small" style="margin-top:10px" data-act="packing">준비물 적으러 가기</button>`}
    </details>`;
}

// 일정: 2박 3일이면 세 칸. 칸마다 어디를 갔고 얼마를 썼는지 줄을 더한다.
// 맨 위는 '여행 준비' — 항공권·숙소처럼 떠나기 전에 결제한 것.
function planCard(trip) {
  const dates = tripDates(trip.start_date, trip.end_date);
  const { prep, rest } = splitPrep(state.plans);
  const byDate = groupPlansByDate(rest, dates);
  const total = sumPlans(state.plans);
  const today = todayLocal();

  const prepSum = sumPlans(prep);
  const prepBox = `
    <div class="plan-day prep">
      <div class="day-head">
        <span>여행 준비<small> 미리 결제</small></span>
        <span class="sub">${prepSum ? formatWon(prepSum) : ''}</span>
      </div>
      ${prep.map((p) => planRow(p, true)).join('')}
      <button type="button" class="plan-add" data-add="prep">＋ 항공권·숙소 같은 것</button>
    </div>`;

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
      ${prepBox}
      ${days}
    </section>`;
}

function planRow(p, showDate = false) {
  const costs = (p.costs ?? []).slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const name = (id) => state.cats.find((c) => c.id === id)?.name ?? '';
  const total = sumCosts(p);
  const when = showDate && p.date ? `<span class="when">${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8, 10))} 결제</span> ` : '';
  return `
    <div class="tx-row plan-row" data-plan="${p.id}">
      <div class="tx-main">
        <div class="tx-cat">${when}${escapeHtml(p.place || name(costs[0]?.category_id) || '메모')}</div>
        ${p.memo ? `<div class="tx-memo">${escapeHtml(p.memo)}</div>` : ''}
        ${costs.length
          ? `<div class="cost-tags">${costs
              .map((c) => `<span class="tag">${escapeHtml(name(c.category_id) || '분류 없음')} ${formatWon(c.amount)}</span>`)
              .join('')}</div>`
          : ''}
      </div>
      <div class="tx-amount">${total ? formatWon(total) : ''}</div>
    </div>`;
}

function onDetailClick(e) {
  const trip = current();
  if (!trip) return;

  // 준비물 접기/펴기 — 다시 그려도 그대로 있게 기억해 둔다 (열림 상태는 이 클릭 뒤에 뒤집힌다)
  if (e.target.closest('#packing-fold > summary')) {
    state.packingOpen = !$('#packing-fold').open;
    return;
  }
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
  paintPacked();
  haptic(on ? 15 : 5);
  try {
    if (on) unwrap(await sb.from('trip_packed').insert({ trip_id: trip.id, item_id: itemId }));
    else unwrap(await sb.from('trip_packed').delete().eq('trip_id', trip.id).eq('item_id', itemId));
  } catch (err) {
    console.error(err);
    if (on) state.packed.delete(itemId);
    else state.packed.add(itemId);
    paintPacked();
    toast(`변경에 실패했어요: ${err.message ?? ''}`);
  }
}

// 체크 표시만 고친다 — 화면을 통째로 다시 그리면 눈에 띄게 흔들린다.
function paintPacked() {
  const list = packing.items();
  for (const row of el.body.querySelectorAll('[data-item]')) {
    const on = state.packed.has(Number(row.dataset.item));
    row.classList.toggle('done', on);
    const check = row.querySelector('.todo-check');
    check.textContent = on ? '✓' : '';
    check.setAttribute('aria-label', on ? '안 챙김' : '챙김');
  }
  for (const head of el.body.querySelectorAll('#packing-fold .group-head')) {
    const name = head.firstElementChild.textContent;
    const items = list.filter((i) => (i.group_name || '기타') === name);
    head.lastElementChild.textContent = `${items.filter((i) => state.packed.has(i.id)).length}/${items.length}`;
  }
  const sum = $('#packing-fold > summary .count');
  if (sum) sum.textContent = `${list.filter((i) => state.packed.has(i.id)).length}/${list.length}`;
  state.rendered = signature();
}

// ---- 일정 줄 시트 ------------------------------------------------------------

function openPlan(plan, date) {
  const trip = current();
  if (!trip) return;
  state.plan = plan ?? null;
  state.planPrep = plan ? !!plan.prep : date === 'prep';
  state.planDate = plan?.date ?? (state.planPrep ? prepDefaultDate() : (date ?? trip.start_date));

  el.planId.value = plan?.id ?? '';
  el.planPlace.value = plan?.place ?? '';
  el.planMemo.value = plan?.memo ?? '';
  el.planDel.hidden = !plan;
  state.dropped = [];
  state.costs = (plan?.costs ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    .map((c) => ({ id: c.id, category_id: c.category_id, amount: c.amount, transaction_id: c.transaction_id }));
  if (!state.costs.length) state.costs.push({ id: null, category_id: defaultCatId(), amount: 0, transaction_id: null });
  renderPlanDays();
  renderCosts();
  validatePlan();
  openSheet(el.planSheet);
  if (!plan) setTimeout(() => el.planPlace.focus(), 250);
}

function renderPlanDays() {
  const trip = current();
  if (!trip) return;
  const dates = tripDates(trip.start_date, trip.end_date);
  el.planDays.innerHTML =
    `<button type="button" class="chip ${state.planPrep ? 'selected' : ''}" data-prep>여행 준비</button>` +
    dates
      .map(
        (date, i) =>
          `<button type="button" class="chip ${!state.planPrep && date === state.planDate ? 'selected' : ''}" data-date="${date}">${i + 1}일째<small> ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}</small></button>`,
      )
      .join('');
  // 준비물은 언제 결제했는지가 날짜다 (기간 밖일 수 있다) — 그때만 날짜 칸을 연다.
  el.planWhen.hidden = !state.planPrep;
  el.planDateInput.value = state.planDate;
  el.planPlace.placeholder = state.planPrep ? '무엇을 결제했나요? (예: 대한항공 왕복)' : '어디를 갔나요? (예: 성산일출봉)';
}

// 미리 결제한 날의 기본값: 대개 오늘이다. 이미 떠난 뒤라면 떠난 날로 둔다.
function prepDefaultDate() {
  const trip = current();
  const today = todayLocal();
  return !trip || today < trip.start_date ? today : trip.start_date;
}

// 지출 줄: 분류 + 금액. 한 장소에서 티켓도 끊고 굿즈도 살 수 있다.
function renderCosts() {
  const trip = state.cats.filter((c) => c.kind === 'trip');
  el.planCosts.innerHTML = state.costs
    .map(
      (c, i) => `
      <div class="cost-row" data-i="${i}">
        <select class="cost-cat" data-i="${i}" aria-label="분류">
          <option value="">분류 없음</option>
          ${trip.map((t) => `<option value="${t.id}" ${t.id === c.category_id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
          <option value="new">＋ 새 분류…</option>
        </select>
        <input class="cost-amount" data-i="${i}" type="text" inputmode="numeric" placeholder="0"
               value="${c.amount ? formatWon(c.amount) : ''}" autocomplete="off">
        ${state.costs.length > 1 ? `<button type="button" class="icon-btn del" data-drop="${i}" aria-label="이 줄 빼기">✕</button>` : ''}
      </div>`,
    )
    .join('');
  validatePlan();
}

function defaultCatId() {
  return state.cats.find((c) => c.kind === 'trip')?.id ?? null;
}

async function onCostInput(e) {
  const at = Number(e.target.dataset.i);
  const cost = state.costs[at];
  if (!cost) return;

  if (e.target.classList.contains('cost-amount')) {
    const n = parseWon(e.target.value);
    e.target.value = n ? formatWon(n) : '';
    cost.amount = n;
    validatePlan();
    return;
  }
  if (!e.target.classList.contains('cost-cat')) return;

  if (e.target.value === 'new') {
    const name = window.prompt('새 분류 이름 (예: 주차비)');
    e.target.value = String(cost.category_id ?? '');
    if (!name || !name.trim()) return;
    try {
      const created = await addCategory(name, 'trip', state.cats);
      state.cats = await fetchCategories();
      cost.category_id = created.id;
      renderCosts();
    } catch (err) {
      console.error(err);
      toast(`분류를 추가하지 못했어요: ${err.message ?? ''}`);
    }
    return;
  }
  cost.category_id = e.target.value ? Number(e.target.value) : null;
}

function validatePlan() {
  const money = state.costs.some((c) => c.amount > 0);
  el.planSave.disabled = !el.planPlace.value.trim() && !money;
}

// 가계부에서 이 지출이 들어갈 카테고리 ('여행' 이 없으면 미분류)
function travelCategoryId() {
  return state.cats.find((c) => c.kind === 'expense' && c.name === '여행')?.id ?? null;
}

async function savePlan() {
  const trip = current();
  if (!trip) return;
  const place = el.planPlace.value.trim();
  const costs = state.costs.filter((c) => c.amount > 0);
  if (!place && !costs.length) return;

  // 금액을 지운 줄은 빼는 것으로 본다
  const dropped = [...state.dropped, ...state.costs.filter((c) => c.id && c.amount <= 0).map((c) => c.id)];
  const catName = (id) => state.cats.find((c) => c.id === id)?.name ?? '';

  el.planSave.disabled = true;
  try {
    unwrap(
      await sb.rpc('save_trip_plan', {
        p: {
          id: state.plan?.id ?? null,
          trip_id: trip.id,
          date: state.planDate,
          prep: state.planPrep,
          place,
          memo: el.planMemo.value.trim(),
          tx_category_id: travelCategoryId(),                  // 가계부는 '여행' 한 덩어리
          removed: dropped,
          costs: costs.map((c, i) => ({
            id: c.id,
            category_id: c.category_id,
            amount: c.amount,
            transaction_id: c.transaction_id,
            sort_order: i,
            tx_memo: [trip.title, catName(c.category_id), place].filter(Boolean).join(' · '),
          })),
        },
      }),
    );
    haptic();
    closeSheet(el.planSheet);
    await showDetail();
    onTxChange();
  } catch (err) {
    console.error(err);
    toast(missingTable(err) ? NEED_SQL : `저장에 실패했어요: ${errText(err)}`);
  } finally {
    el.planSave.disabled = false;
  }
}

async function removePlan() {
  if (!state.plan) return;
  const spent = sumCosts(state.plan);
  const msg = spent
    ? `이 줄을 지우면 가계부의 ${formatWon(spent)}원 지출도 함께 사라져요. 지울까요?`
    : '이 줄을 지울까요?';
  if (!confirmDialog(msg)) return;
  try {
    const had = sumCosts(state.plan) > 0;
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
    toast(
      missingTable(err)
        ? '여행 표가 아직 없어요. schema.sql 전체를 한 번 실행해 주세요'
        : `저장에 실패했어요: ${err.message ?? ''}`,
    );
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
