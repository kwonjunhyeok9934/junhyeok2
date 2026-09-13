// 여행 칸의 지도 화면: 다녀온 시·군·구를 색칠하고, 지역을 누르면 그 지역 여행을 보여 준다.
// 지도는 js/koreamap.js (자동 생성). 색은 두 가지에서 온다 —
//   여행 기록이 있는 지역(trip.js) + 직접 칠한 지역(visited_regions).
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, haptic, animateNumber } from './ui.js';
import { VIEWBOX, REGIONS, SIDO_ORDER } from './koreamap.js';
import { visitedStats, tripLabel } from './calc.js';
import * as trip from './trip.js';

const NAME = new Map(REGIONS.map((r) => [r.c, r.n]));
const SIDO = new Map(REGIONS.map((r) => [r.c, r.s]));
const [, , VBW, VBH] = VIEWBOX.split(' ').map(Number);
const MAX_ZOOM = 14;

const state = {
  visited: new Set(),
  userId: null,
  pending: new Set(), // 저장 중인 코드 (연타 방지)
  region: null,       // 시트에 열어 둔 지역
};

// 지도 확대·이동 상태. translate 뒤 scale 순서로 <g> 에 건다.
const view = { k: 1, x: 0, y: 0 };

let el = null;
let initialized = false;

export function init({ userId }) {
  state.userId = userId;
  if (initialized) return;
  initialized = true;

  el = {
    tab: $('#tab-travel'),
    done: $('#travel-done'),
    total: $('#travel-total'),
    bar: $('#travel-bar'),
    hint: $('#travel-hint'),
    wrap: $('#map-wrap'),
    svg: $('#korea-map'),
    layer: $('#map-layer'),
    sido: $('#travel-sido'),
    sidoList: $('#travel-sido-list'),
    notice: $('#travel-notice'),
    sheet: $('#sheet-region'),
    name: $('#region-name'),
    sidoName: $('#region-sido'),
    been: $('#region-been'),
    trips: $('#region-trips'),
    newTrip: $('#region-new-trip'),
  };

  el.svg.setAttribute('viewBox', VIEWBOX);
  el.layer.innerHTML = REGIONS.map(
    (r) => `<path data-c="${r.c}" d="${r.d}"><title>${escapeHtml(r.n)}</title></path>`,
  ).join('');

  bindGestures();
  bindSheetBackdrop(el.sheet);
  $('#map-zoom-in').addEventListener('click', () => zoomBy(1.6));
  $('#map-zoom-out').addEventListener('click', () => zoomBy(1 / 1.6));
  $('#map-reset').addEventListener('click', resetView);
  el.tab.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) refresh();
  });

  el.been.addEventListener('click', () => {
    const code = state.region;
    closeSheet(el.sheet);
    toggleVisited(code);
  });
  el.newTrip.addEventListener('click', () => {
    closeSheet(el.sheet);
    trip.openNew(state.region);
  });
  el.trips.addEventListener('click', (e) => {
    const row = e.target.closest('[data-trip]');
    if (!row) return;
    closeSheet(el.sheet);
    trip.openTrip(Number(row.dataset.trip));
  });
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

// ---- 조회 ------------------------------------------------------------------

export async function refresh() {
  if (!initialized) return;
  try {
    const rows = unwrap(await sb.from('visited_regions').select('code'));
    state.visited = new Set(rows.map((r) => r.code));
    el.notice.hidden = true;
    el.wrap.hidden = false;
    render();
  } catch (err) {
    console.error(err);
    el.wrap.hidden = true;
    el.notice.hidden = false;
    el.notice.innerHTML = missingTable(err)
      ? `<p class="empty">여행 표가 아직 없어요.<br>Supabase SQL Editor 에서<br><code>schema.sql</code> 의 23·25번 섹션을 실행해 주세요.</p>`
      : `<div class="retry">불러오지 못했어요<br>
          <button type="button" class="btn small" data-retry>다시 시도</button>
        </div>`;
  }
}

// 아직 SQL 을 실행하지 않아 표가 없는 상태인지.
function missingTable(err) {
  const m = `${err?.message ?? ''} ${err?.code ?? ''}`;
  return /does not exist|could not find the table|42P01|PGRST205/i.test(m);
}

// ---- 렌더 ------------------------------------------------------------------

// 여행이 바뀌었을 때 app.js 가 부른다 (지도만 다시 칠한다).
export function render() {
  if (!initialized) return;
  const trips = trip.regionCodes();
  for (const path of el.layer.children) {
    const code = path.dataset.c;
    path.classList.toggle('been', state.visited.has(code));
    path.classList.toggle('trip', trips.has(code));
  }
  renderSummary(trips);
  if (state.region && el.sheet.classList.contains('open')) renderRegionSheet();
}

function renderSummary(trips) {
  const all = new Set([...state.visited, ...trips]);
  const stat = visitedStats(REGIONS, all, SIDO_ORDER);
  animateNumber(el.done, stat.done, (n) => String(n));
  el.total.textContent = `/ ${stat.total}곳 · ${stat.percent}%`;
  el.bar.style.width = `${stat.percent}%`;
  el.hint.hidden = stat.done > 0;

  el.sido.hidden = stat.done === 0;
  el.sidoList.innerHTML = stat.sido
    .map(
      (s) => `
      <li class="${s.done ? '' : 'zero'}">
        <span>${escapeHtml(s.name)}</span>
        <span class="mini-bar"><i style="width:${Math.round((s.done / s.total) * 100)}%"></i></span>
        <span class="num">${s.done}/${s.total}</span>
      </li>`,
    )
    .join('');
}

// ---- 지역 시트 --------------------------------------------------------------

function openRegionSheet(code) {
  state.region = code;
  renderRegionSheet();
  openSheet(el.sheet);
  haptic(5);
}

function renderRegionSheet() {
  const code = state.region;
  const trips = trip.tripsIn(code);
  const been = state.visited.has(code);

  el.name.textContent = NAME.get(code) ?? '';
  el.sidoName.textContent = SIDO.get(code) ?? '';
  el.been.textContent = been ? '다녀온 곳에서 빼기' : '다녀온 곳으로 표시';
  el.been.classList.toggle('primary', !been);

  el.trips.innerHTML = trips.length
    ? `<h2 class="list-head">여행 <span class="count">${trips.length}</span></h2>` +
      trips
        .map(
          (t, i) => `
        <div class="card trip-card small" data-trip="${t.id}" style="--i:${Math.min(i, 12)}">
          <div class="trip-main">
            <div class="trip-title">${escapeHtml(t.title)}</div>
            <div class="trip-when">${tripLabel(t.start_date, t.end_date)}</div>
          </div>
        </div>`,
        )
        .join('')
    : '<p class="hint">이 지역 여행 기록이 아직 없어요</p>';
}

// ---- 색칠 ------------------------------------------------------------------

async function toggleVisited(code) {
  if (state.pending.has(code)) return;
  const on = !state.visited.has(code);

  // 먼저 칠하고 저장한다. 실패하면 되돌린다.
  state.pending.add(code);
  if (on) state.visited.add(code);
  else state.visited.delete(code);
  render();
  haptic(on ? 15 : 5);

  try {
    if (on) unwrap(await sb.from('visited_regions').insert({ code, name: NAME.get(code) ?? '', created_by: state.userId }));
    else unwrap(await sb.from('visited_regions').delete().eq('code', code));
    toast(`${NAME.get(code) ?? ''} ${on ? '다녀온 곳에 추가했어요' : '다녀온 곳에서 뺐어요'}`, 1400);
  } catch (err) {
    console.error(err);
    if (on) state.visited.delete(code);
    else state.visited.add(code);
    render();
    toast(missingTable(err) ? '여행 표가 아직 없어요. schema.sql 23번을 실행해 주세요' : '저장에 실패했어요. 다시 시도해 주세요');
  } finally {
    state.pending.delete(code);
  }
}

// ---- 확대·이동 --------------------------------------------------------------

function applyView() {
  view.k = Math.min(MAX_ZOOM, Math.max(1, view.k));
  view.x = Math.min(0, Math.max(VBW * (1 - view.k), view.x));
  view.y = Math.min(0, Math.max(VBH * (1 - view.k), view.y));
  el.layer.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  el.wrap.classList.toggle('zoomed', view.k > 1.01);
}

function resetView() {
  view.k = 1;
  view.x = 0;
  view.y = 0;
  applyView();
}

// 화면 좌표 → 지도 좌표(viewBox 단위, <g> 변환 전).
function toUser(clientX, clientY) {
  const m = el.svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  return new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
}

// 화면 가운데를 기준으로 확대·축소 (＋ − 버튼).
function zoomBy(factor) {
  const r = el.wrap.getBoundingClientRect();
  zoomAt(view.k * factor, toUser(r.left + r.width / 2, r.top + r.height / 2));
}

// 지도 좌표 u 아래 있던 지점을 그대로 둔 채 배율만 바꾼다.
function zoomAt(k, u) {
  const next = Math.min(MAX_ZOOM, Math.max(1, k));
  view.x = u.x - ((u.x - view.x) / view.k) * next;
  view.y = u.y - ((u.y - view.y) / view.k) * next;
  view.k = next;
  applyView();
}

function bindGestures() {
  const pointers = new Map();
  let last = null;   // 한 손가락: 직전 위치
  let pinch = null;  // 두 손가락: { dist, k, p }
  let tap = null;    // 누른 자리·시각 (움직이지 않았으면 지역 열기)

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const two = () => [...pointers.values()];
  // 손가락을 붙잡는 건 실제로 움직이기 시작할 때만. 처음부터 붙잡으면
  // 지도 위 확대·축소 버튼이 눌리지 않는다 (클릭이 이쪽으로 끌려온다).
  const grab = (e) => {
    if (!el.wrap.hasPointerCapture(e.pointerId)) el.wrap.setPointerCapture(e.pointerId);
  };

  el.wrap.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.map-tools')) return; // 버튼은 버튼대로
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      last = { x: e.clientX, y: e.clientY };
      tap = { x: e.clientX, y: e.clientY, t: Date.now() };
    } else if (pointers.size === 2) {
      tap = null;
      const [a, b] = two();
      const u = toUser((a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = { dist: dist(a, b), k: view.k, p: { x: (u.x - view.x) / view.k, y: (u.y - view.y) / view.k } };
    }
  });

  el.wrap.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2 && pinch) {
      const [a, b] = two();
      const now = dist(a, b);
      if (!now) return;
      const k = Math.min(MAX_ZOOM, Math.max(1, (pinch.k * now) / pinch.dist));
      const u = toUser((a.x + b.x) / 2, (a.y + b.y) / 2);
      grab(e);
      view.k = k;
      view.x = u.x - pinch.p.x * k;
      view.y = u.y - pinch.p.y * k;
      applyView();
      return;
    }

    if (pointers.size === 1 && last) {
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap = null;
      if (view.k > 1.01) {
        grab(e);
        const from = toUser(last.x, last.y);
        const to = toUser(e.clientX, e.clientY);
        view.x += to.x - from.x;
        view.y += to.y - from.y;
        applyView();
      }
      last = { x: e.clientX, y: e.clientY };
    }
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return; // 버튼에서 시작한 터치
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      last = null;
      if (tap && Date.now() - tap.t < 600) {
        const hit = document.elementFromPoint(tap.x, tap.y)?.closest('path[data-c]');
        if (hit) openRegionSheet(hit.dataset.c);
      }
      tap = null;
    }
  };
  el.wrap.addEventListener('pointerup', end);
  el.wrap.addEventListener('pointercancel', end);

  // 마우스 휠 (PC 에서 볼 때)
  el.wrap.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), toUser(e.clientX, e.clientY));
    },
    { passive: false },
  );
}
