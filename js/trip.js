// 여행 칸의 '내 여행' 화면: 여행 목록·상세·만들기.
// 여행 하나 = 제목 + 기간 + 지역 여러 개. 지도(travel.js)는 이걸 읽어 자동으로 색칠한다.
// 여행 중에 쓴 돈은 따로 적지 않는다 — 가계부에서 그 기간을 더해 보여 준다.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic } from './ui.js';
import { REGIONS } from './koreamap.js';
import { todayLocal, formatWon, tripLabel, tripNights, tripStatus, sortTrips, tripsByRegion } from './calc.js';

const state = {
  trips: [],
  byRegion: new Map(),
  userId: null,
  editing: null,   // 시트에서 고치는 중인 여행 (새 여행이면 null)
  picked: [],      // 시트에서 고른 지역 [{ code, name }]
  viewing: null,   // 상세로 열어 둔 여행 id
  items: [],       // 그 여행의 준비물
  spend: null,     // 그 여행 기간의 가계부 { total, count }
};

let el = null;
let initialized = false;
let onChange = () => {};      // 여행이 바뀌면 지도도 다시 그리게
let onShowRange = () => {};   // 가계부에서 이 기간 보기

export function init({ userId, onChange: changed, onShowRange: showRange }) {
  state.userId = userId;
  if (changed) onChange = changed;
  if (showRange) onShowRange = showRange;
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
  };

  bindSheetBackdrop(el.sheet);

  for (const box of [el.upcoming, el.past]) {
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) return refresh();
      const card = e.target.closest('.trip-card');
      if (card) openTrip(Number(card.dataset.id));
    });
  }

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
  el.del.addEventListener('click', remove);

  $('#trip-close').addEventListener('click', closeDetail);
  $('#trip-edit').addEventListener('click', () => {
    const trip = current();
    if (trip) openSheetFor(trip);
  });
  el.body.addEventListener('click', onDetailClick);
  el.body.addEventListener('submit', onItemAdd);
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

// 아직 SQL 을 실행하지 않아 표가 없는 상태인지.
function missingTable(err) {
  const m = `${err?.message ?? ''} ${err?.code ?? ''}`;
  return /does not exist|could not find the table|42P01|PGRST205/i.test(m);
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
      ? `<p class="empty">여행 표가 아직 없어요.<br>Supabase SQL Editor 에서<br><code>schema.sql</code> 의 25번 섹션을 실행해 주세요.</p>`
      : `<div class="retry">불러오지 못했어요<br>
          <button type="button" class="btn small" data-retry>다시 시도</button>
        </div>`;
  }
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
  state.items = [];
  state.spend = null;
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
    const [items, txs] = await Promise.all([
      sb.from('trip_items').select('*').eq('trip_id', trip.id).order('created_at', { ascending: true }).then(unwrap),
      sb.from('transactions').select('kind,amount').gte('date', trip.start_date).lte('date', trip.end_date).then(unwrap),
    ]);
    state.items = items;
    const spent = txs.filter((t) => t.kind === 'expense');
    state.spend = { total: spent.reduce((a, t) => a + t.amount, 0), count: spent.length };
  } catch (err) {
    console.error(err);
    state.spend = null;
  }
  el.viewTitle.textContent = trip.title;
  renderDetail();
}

function renderDetail() {
  const trip = current();
  if (!trip) return;
  const st = tripStatus(trip, todayLocal());
  const { days } = tripNights(trip.start_date, trip.end_date);
  const done = state.items.filter((i) => i.done).length;
  const spend = state.spend;

  el.body.innerHTML = `
    <section class="card trip-head ${st.state}">
      <div class="trip-dday ${st.state} big">${st.text}</div>
      <div class="trip-when">${tripLabel(trip.start_date, trip.end_date)}</div>
      <div class="chips read">${(trip.regions ?? [])
        .map((r) => `<span class="chip">${escapeHtml(r.name || r.code)}</span>`)
        .join('') || '<span class="hint">지역을 안 골랐어요</span>'}</div>
      ${trip.memo ? `<p class="trip-memo">${escapeHtml(trip.memo)}</p>` : ''}
    </section>

    <section class="card">
      <h2>준비물 ${state.items.length ? `<span class="count">${done}/${state.items.length}</span>` : ''}</h2>
      <form id="item-quick" class="row quick">
        <input id="item-title" type="text" placeholder="챙길 것을 적고 Enter" maxlength="60" autocomplete="off">
        <button type="submit" class="btn primary small">추가</button>
      </form>
      <div class="item-list">
        ${state.items.length
          ? state.items.map((it) => itemRow(it)).join('')
          : '<p class="hint">아직 없어요. 충전기·우산처럼 챙길 것을 적어 두세요.</p>'}
      </div>
    </section>

    <section class="card">
      <h2>이 기간 가계부</h2>
      ${spend
        ? `<div class="trip-spend"><strong>${formatWon(spend.total)}</strong><span>원</span></div>
           <p class="hint">${spend.count}건 · 하루 평균 ${formatWon(Math.round(spend.total / days))}원</p>`
        : '<p class="hint">불러오는 중…</p>'}
      <button type="button" class="btn small" data-act="ledger" style="margin-top:10px">가계부에서 이 기간 보기</button>
    </section>

    <button type="button" class="btn wide danger" data-act="remove">이 여행 삭제</button>`;
}

function itemRow(it) {
  return `
    <div class="todo-row item-row ${it.done ? 'done' : ''}" data-item="${it.id}">
      <button type="button" class="todo-check" aria-label="${it.done ? '준비 해제' : '준비 완료'}">${it.done ? '✓' : ''}</button>
      <div class="todo-main"><div class="todo-title">${escapeHtml(it.title)}</div></div>
      <button type="button" class="icon-btn del" data-act="item-del" aria-label="삭제">✕</button>
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
  if (act === 'remove') {
    remove(trip);
    return;
  }
  const row = e.target.closest('[data-item]');
  if (!row) return;
  const item = state.items.find((i) => i.id === Number(row.dataset.item));
  if (!item) return;
  if (act === 'item-del') removeItem(item);
  else toggleItem(item);
}

async function onItemAdd(e) {
  if (e.target.id !== 'item-quick') return;
  e.preventDefault();
  const trip = current();
  const input = $('#item-title');
  const title = input.value.trim();
  if (!trip || !title) return;
  input.value = '';
  try {
    unwrap(await sb.from('trip_items').insert({ trip_id: trip.id, title }));
    await showDetail();
    $('#item-title')?.focus();
  } catch (err) {
    console.error(err);
    toast('저장에 실패했어요. 다시 시도해 주세요');
  }
}

async function toggleItem(item) {
  const done = !item.done;
  item.done = done;
  renderDetail();
  if (done) haptic(15);
  try {
    unwrap(await sb.from('trip_items').update({ done }).eq('id', item.id));
  } catch (err) {
    console.error(err);
    item.done = !done;
    renderDetail();
    toast('변경에 실패했어요. 다시 시도해 주세요');
  }
}

async function removeItem(item) {
  try {
    unwrap(await sb.from('trip_items').delete().eq('id', item.id));
    await showDetail();
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
  el.pick.hidden = true;
  el.search.value = '';
  el.results.innerHTML = '';
  renderPicked();
  openSheet(el.sheet);
  if (!trip) setTimeout(() => el.title.focus(), 250);
}

function nameOf(code) {
  return REGIONS.find((r) => r.c === code)?.n ?? code;
}

function renderPicked() {
  el.regions.innerHTML =
    state.picked
      .map((r) => `<button type="button" class="chip selected" data-drop="${r.code}">${escapeHtml(r.name)} ✕</button>`)
      .join('') + '<button type="button" class="chip add" data-add>＋ 지역</button>';
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
  const ok = el.title.value.trim() && el.start.value && el.end.value && el.start.value <= el.end.value;
  el.save.disabled = !ok;
  el.span.textContent = ok ? tripLabel(el.start.value, el.end.value) : '';
}

async function save() {
  const payload = {
    title: el.title.value.trim(),
    start_date: el.start.value,
    end_date: el.end.value,
    memo: el.memo.value.trim(),
  };
  if (!payload.title || payload.start_date > payload.end_date) return;
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
    if (state.picked.length) {
      unwrap(await sb.from('trip_regions').insert(state.picked.map((r) => ({ trip_id: id, code: r.code, name: r.name }))));
    }
    haptic();
    closeSheet(el.sheet);
    await refresh();
    openTrip(id);
  } catch (err) {
    console.error(err);
    toast(missingTable(err) ? '여행 표가 아직 없어요. schema.sql 25번을 실행해 주세요' : '저장에 실패했어요. 다시 시도해 주세요');
  } finally {
    el.save.disabled = false;
  }
}

async function remove(trip = state.editing) {
  if (!trip) return;
  if (!confirmDialog(`"${trip.title}" 여행을 삭제할까요?\n준비물과 지도 색칠도 함께 사라져요.`)) return;
  try {
    unwrap(await sb.from('trips').delete().eq('id', trip.id));
    closeSheet(el.sheet);
    closeDetail();
    await refresh();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
}
