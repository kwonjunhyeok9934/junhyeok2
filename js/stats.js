// 통계 탭: 주·월·년 지출을 카테고리별 원형 그래프로. 카테고리를 누르면 그 안을 한 번 더 나눠 본다
// (식비는 어떻게 — 배달·컬리·마트…, 나머지는 메모로). 누가 얼마 썼는지와 내역도 같이 보인다.
//
// 원형은 조각이 많으면 색이 서로 안 구별된다. 그래서 큰 것부터 다섯 개 + '기타' 까지만 그리고,
// 아래 목록에 이름·금액·퍼센트를 글자로 다 적는다 — 색만 보고 읽을 필요가 없게.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, haptic, animateNumber } from './ui.js';
import {
  todayLocal, formatWon, dayName,
  STAT_UNITS, statRange, shiftStat, statLabel, statCompare, donutSlices, assignSlots,
  statByCategory, statByHow, statByMemo, statByWho,
} from './calc.js';
import { fetchCategories } from './categories.js';

const UNIT_KEY = 'stats.unit';
const SLOTS = 6; // css 의 --series-1 ~ 6

const state = {
  unit: 'month',
  anchor: todayLocal(),
  txs: [],        // 이 기간 지출
  prevTotal: 0,   // 지난 기간 지출 합
  cats: [],
  profiles: [],
  howOfTx: new Map(),
  selected: null, // 원에서 고른 조각 key
  detail: null,   // 시트에 열린 카테고리 key
};

let el = null;
let initialized = false;
let loadSeq = 0;

export function init() {
  if (initialized) return;
  initialized = true;
  try {
    const saved = localStorage.getItem(UNIT_KEY);
    if (STAT_UNITS.includes(saved)) state.unit = saved;
  } catch { /* 저장소를 못 쓰면 월로 */ }

  el = {
    units: $('#stat-units'),
    label: $('#stat-label'),
    prev: $('#stat-prev'),
    next: $('#stat-next'),
    today: $('#stat-today'),
    total: $('#stat-total'),
    compare: $('#stat-compare'),
    avg: $('#stat-avg'),
    chart: $('#stat-chart'),
    sheet: $('#sheet-stat'),
    detail: $('#stat-detail'),
  };
  el.units.querySelector(`input[value="${state.unit}"]`).checked = true;
  el.units.addEventListener('change', (e) => {
    state.unit = e.target.value;
    state.anchor = todayLocal();
    state.selected = null;
    try { localStorage.setItem(UNIT_KEY, state.unit); } catch { /* 무시 */ }
    refresh();
  });
  el.prev.addEventListener('click', () => move(-1));
  el.next.addEventListener('click', () => move(1));
  el.today.addEventListener('click', () => { state.anchor = todayLocal(); state.selected = null; refresh(); });
  bindSheetBackdrop(el.sheet);

  el.chart.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-seg]');
    if (seg) {
      // 원의 조각: 처음 누르면 가운데에 그 조각을 보여 주고, 한 번 더 누르면 자세히 연다.
      const key = seg.dataset.seg;
      if (state.selected === key) openDetail(key);
      else { state.selected = key; renderChart(); haptic(); }
      return;
    }
    const row = e.target.closest('[data-key]');
    if (row) openDetail(row.dataset.key);
    if (e.target.closest('[data-retry]')) refresh();
  });
  el.detail.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeSheet(el.sheet); return; }
    const row = e.target.closest('[data-cat]');
    if (row) openDetail(row.dataset.cat); // 기타 안의 카테고리
  });
}

function move(delta) {
  state.anchor = shiftStat(state.unit, state.anchor, delta);
  state.selected = null;
  refresh();
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export async function refresh() {
  if (!initialized) return;
  const seq = ++loadSeq;
  const range = statRange(state.unit, state.anchor);
  const prev = statRange(state.unit, shiftStat(state.unit, state.anchor, -1));
  const today = todayLocal();
  el.label.textContent = statLabel(state.unit, state.anchor);
  el.next.disabled = range.end >= today; // 앞으로는 쓴 돈이 없다
  el.today.hidden = range.start <= today && today <= range.end;
  try {
    const [cats, txs, profiles, buys, pantry] = await Promise.all([
      fetchCategories(),
      sb.from('transactions')
        .select('id,kind,amount,category_id,date,memo,created_by')
        .eq('kind', 'expense')
        .gte('date', prev.start)
        .lte('date', range.end)
        .order('date', { ascending: false })
        .then(unwrap),
      sb.from('profiles').select('id,name,color').then(unwrap).catch(() => []),
      // 식비를 '어떻게' 로 나누려고: 끼니 세트와 사 둔 것이 어느 거래에 붙어 있는지.
      // 표가 아직 없어도 통계는 떠야 하니 실패하면 빈 것으로 본다.
      sb.from('meal_buys').select('transaction_id,how_id').not('transaction_id', 'is', null).then(unwrap).catch(() => []),
      sb.from('pantry_items').select('transaction_id,how_id').not('transaction_id', 'is', null).then(unwrap).catch(() => []),
    ]);
    if (seq !== loadSeq) return; // 그사이 기간을 또 옮겼다
    state.cats = cats;
    state.profiles = profiles;
    state.txs = txs.filter((t) => t.date >= range.start && t.date <= range.end);
    state.prevTotal = txs.filter((t) => t.date < range.start).reduce((a, t) => a + t.amount, 0);
    state.howOfTx = new Map();
    for (const r of [...pantry, ...buys]) if (r.how_id != null) state.howOfTx.set(r.transaction_id, r.how_id);
    render(range, today);
    if (el.sheet.classList.contains('open') && state.detail !== null) renderDetail(state.detail);
  } catch (err) {
    console.error(err);
    if (seq !== loadSeq) return;
    el.chart.innerHTML = `<div class="retry">불러오지 못했어요<br><button type="button" class="btn small" data-retry>다시 시도</button></div>`;
  }
}

// ---- 위: 합계 · 지난 기간과 비교 · 하루 평균 --------------------------------------

function render(range, today) {
  const total = state.txs.reduce((a, t) => a + t.amount, 0);
  animateNumber(el.total, total, (n) => `${formatWon(n)}원`);

  const cmp = statCompare(state.unit, total, state.prevTotal);
  if (!cmp) el.compare.textContent = '';
  else if (cmp.diff === 0) el.compare.textContent = `${cmp.word}와 똑같이 썼어요`;
  else {
    const more = cmp.diff > 0;
    el.compare.innerHTML = `${cmp.word}보다 <b class="${more ? 'up' : 'down'}">${formatWon(Math.abs(cmp.diff))}원 ${more ? '더' : '덜'}</b> 썼어요 <small>(${more ? '▲' : '▼'} ${cmp.pct}%)</small>`;
  }

  // 하루 평균: 이번 기간이면 오늘까지의 날 수로 나눈다 (월초에 한 달로 나누면 너무 작게 나온다).
  const last = range.end < today ? range.end : today;
  const days = range.start > today ? 0 : daysBetween(range.start, last) + 1;
  el.avg.textContent = total && days ? `하루 평균 ${formatWon(Math.round(total / days))}원` : '';

  renderChart();
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// ---- 가운데: 원형 + 목록 --------------------------------------------------------

// 카테고리가 목록에서 몇 번째인지 = 그 카테고리의 색 칸. 기간을 옮겨도 식비는 늘 같은 색이다.
function prefOfKind(kind) {
  const order = state.cats.filter((c) => c.kind === kind).map((c) => c.id);
  return (key) => order.indexOf(key === null || key === 'null' ? null : Number(key));
}

const keyOf = (k) => (k === null ? 'null' : String(k));
const slotClass = (slot) => (slot >= 0 ? `s${slot + 1}` : 'so');

function renderChart() {
  const rows = statByCategory(state.txs, state.cats).map((r) => ({ ...r, key: keyOf(r.key) }));
  const slices = donutSlices(rows);
  if (!slices.length) {
    el.chart.innerHTML = '<p class="empty">이 기간에 쓴 돈이 없어요</p>';
    return;
  }
  if (state.selected && !slices.some((s) => s.key === state.selected)) state.selected = null;
  const slots = assignSlots(slices, prefOfKind('expense'), SLOTS);
  const total = slices.reduce((a, s) => a + s.total, 0);
  const sel = slices.find((s) => s.key === state.selected);
  el.chart.innerHTML = `
    ${donutHtml(slices, slots, { selected: state.selected, center: sel
      ? { top: sel.name, big: `${formatWon(sel.total)}원`, sub: `${sel.pct}% · 자세히 ›` }
      : { top: '지출', big: `${formatWon(total)}원`, sub: `${rows.length}개 카테고리` } })}
    <div class="stat-list">${slices.map((s) => rowHtml(s, slots.get(s.key), { selected: s.key === state.selected })).join('')}</div>`;
}

// 원형 그래프. 조각 사이에 2px 틈을 두고(카드 색이 비친다), 고른 조각 말고는 옅게 한다.
function donutHtml(slices, slots, { selected = null, center, size = 'big' }) {
  const R = 90;
  const r = 60;
  const total = slices.reduce((a, s) => a + s.total, 0);
  const one = slices.length === 1;
  let at = 0;
  const segs = slices.map((s) => {
    const a0 = (at / total) * 360;
    at += s.total;
    const a1 = (at / total) * 360;
    const cls = `${slotClass(slots.get(s.key))}${selected && selected !== s.key ? ' dim' : ''}`;
    const label = `${s.name} ${formatWon(s.total)}원 ${s.pct}%`;
    if (one) {
      return `<g data-seg="${escapeHtml(s.key)}" class="dseg ${cls}"><title>${escapeHtml(label)}</title>
        <circle cx="100" cy="100" r="${(R + r) / 2}" fill="none" stroke-width="${R - r}"></circle></g>`;
    }
    return `<path data-seg="${escapeHtml(s.key)}" class="dseg ${cls}" d="${arcPath(a0, a1, R, r)}"><title>${escapeHtml(label)}</title></path>`;
  });
  return `
    <div class="donut ${size}">
      <svg viewBox="0 0 200 200" role="img" aria-label="${escapeHtml(slices.map((s) => `${s.name} ${s.pct}%`).join(', '))}">${segs.join('')}</svg>
      <div class="donut-center">
        <span class="top">${escapeHtml(center.top)}</span>
        <strong>${escapeHtml(center.big)}</strong>
        ${center.sub ? `<span class="sub">${escapeHtml(center.sub)}</span>` : ''}
      </div>
    </div>`;
}

// 도넛 한 조각. 각도는 12시에서 시계 방향. 조각 양 끝을 1도씩 깎아 틈을 만든다.
function arcPath(a0, a1, R, r) {
  const gap = Math.min(1, (a1 - a0) / 4);
  const s = a0 + gap;
  const e = a1 - gap;
  const pt = (rad, deg) => {
    const t = ((deg - 90) * Math.PI) / 180;
    return `${(100 + rad * Math.cos(t)).toFixed(2)} ${(100 + rad * Math.sin(t)).toFixed(2)}`;
  };
  const large = e - s > 180 ? 1 : 0;
  return `M ${pt(R, s)} A ${R} ${R} 0 ${large} 1 ${pt(R, e)} L ${pt(r, e)} A ${r} ${r} 0 ${large} 0 ${pt(r, s)} Z`;
}

// 목록 한 줄: 색 점 · 이름 · 건수 · 퍼센트 · 금액, 그 아래 얇은 막대.
function rowHtml(s, slot, { selected = false, attr = 'data-key', tappable = true } = {}) {
  const count = s.other ? `${s.members.length}개 카테고리` : s.count ? `${s.count}건` : '';
  return `
    <${tappable ? 'button type="button"' : 'div'} class="stat-row${selected ? ' selected' : ''}" ${attr}="${escapeHtml(s.key)}">
      <span class="dot ${slotClass(slot)}"></span>
      <span class="nm">${escapeHtml(s.name)}${count ? `<small>${count}</small>` : ''}</span>
      <span class="pct">${s.pct}%</span>
      <span class="amt">${formatWon(s.total)}원</span>
      <span class="track"><i class="${slotClass(slot)}" style="width:${Math.max(1, s.pct)}%"></i></span>
    </${tappable ? 'button' : 'div'}>`;
}

// ---- 시트: 카테고리 하나 자세히 -----------------------------------------------------

function openDetail(key) {
  state.detail = key;
  renderDetail(key);
  openSheet(el.sheet);
  el.sheet.querySelector('.sheet-panel').scrollTop = 0;
  haptic();
}

function renderDetail(key) {
  const all = statByCategory(state.txs, state.cats).map((r) => ({ ...r, key: keyOf(r.key) }));
  const slices = donutSlices(all);
  const total = slices.reduce((a, s) => a + s.total, 0);
  const slots = assignSlots(slices, prefOfKind('expense'), SLOTS);
  const slice = slices.find((s) => s.key === key)
    // 기타 안에 있던 카테고리를 눌렀을 때: 원에는 없지만 목록에서 찾는다
    ?? (() => { const r = all.find((x) => x.key === key); return r && { ...r, pct: total ? Math.round((r.total / total) * 100) : 0 }; })();
  if (!slice) { closeSheet(el.sheet); return; }

  const head = `
    <div class="stat-detail-head">
      <span class="dot ${slotClass(slots.get(key) ?? -1)}"></span>
      <h2>${escapeHtml(slice.name)}</h2>
      <button type="button" class="icon-btn" data-close aria-label="닫기">✕</button>
    </div>
    <p class="stat-detail-sub">${escapeHtml(statLabel(state.unit, state.anchor))} · 전체 지출의 ${slice.pct}%</p>
    <strong class="stat-detail-total">${formatWon(slice.total)}원</strong>`;

  // 기타: 모인 카테고리들을 늘어놓고, 누르면 그 카테고리를 연다.
  if (slice.other) {
    const members = donutSlices(slice.members, 99);
    el.detail.innerHTML = `${head}
      <h3 class="stat-h3">모인 카테고리</h3>
      <div class="stat-list">${members.map((m) => rowHtml(m, -1, { attr: 'data-cat' })).join('')}</div>`;
    return;
  }

  const txs = state.txs.filter((t) => keyOf(t.category_id ?? null) === key);
  const isMeal = slice.name === '식비';
  const subRows = (isMeal ? statByHow(txs, state.howOfTx, state.cats) : statByMemo(txs)).map((r) => ({ ...r, key: keyOf(r.key) }));
  const sub = donutSlices(subRows);
  // 메모로 나눴는데 전부 '메모 없음' 이면 나눠 보여 줄 게 없다.
  const showSub = sub.length > 1 || (sub.length === 1 && sub[0].key !== 'null');
  const subSlots = assignSlots(sub, prefOfKind('meal_how'), SLOTS);
  const subTitle = isMeal ? '어떻게 썼나' : '어디에 썼나 (메모별)';
  const top = sub[0];

  const who = statByWho(txs, state.profiles);

  el.detail.innerHTML = `${head}
    ${showSub ? `
      <h3 class="stat-h3">${subTitle}</h3>
      ${donutHtml(sub, subSlots, { size: 'small', center: { top: top.name, big: `${top.pct}%`, sub: `${formatWon(top.total)}원` } })}
      <div class="stat-list">${sub.map((s) => rowHtml(s, subSlots.get(s.key), { tappable: false })).join('')}</div>
      ${isMeal && sub.some((s) => s.key === 'null') ? '<p class="hint">직접 적음 = 식비 탭·사 둔 것을 거치지 않고 가계부에 바로 적은 식비</p>' : ''}` : ''}
    ${who.length > 1 ? `
      <h3 class="stat-h3">누가 썼나</h3>
      <div class="who-bar">${who.map((w) => `<i style="width:${w.pct}%;background:${escapeHtml(w.color || 'var(--muted)')}"></i>`).join('')}</div>
      <div class="who-legend">${who.map((w) => `
        <span><span class="dot" style="background:${escapeHtml(w.color || 'var(--muted)')}"></span>${escapeHtml(w.name)} <b>${formatWon(w.total)}원</b> <small>${w.pct}%</small></span>`).join('')}
      </div>` : ''}
    <h3 class="stat-h3">내역 <small>${txs.length}건</small></h3>
    <div class="stat-txs">${txs.slice(0, 100).map((t) => `
      <div class="stat-tx">
        <span class="d">${escapeHtml(shortDay(t.date))}</span>
        <span class="m">${escapeHtml(t.memo || '메모 없음')}</span>
        <span class="a">${formatWon(t.amount)}원</span>
      </div>`).join('')}
      ${txs.length > 100 ? `<p class="hint">최근 100건만 보여요</p>` : ''}
    </div>`;
}

// '9/24 (목)'. 목록이 좁아서 '9월 24일' 보다 짧게 적는다.
function shortDay(date) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} (${dayName(date)})`;
}
