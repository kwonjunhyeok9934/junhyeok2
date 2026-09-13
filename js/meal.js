// 식비 탭: 한 주(월~일)의 아침·점심·저녁·야식 식단.
// 한 끼 = 날짜·끼니·메뉴·누가·어디서 하나씩 + '어떻게' 세트 0..N.
// 세트 하나가 가계부 거래 한 건과 연결된다. 품목 가격이 원본이고 거래에는 그 합계가 들어간다.
// 저장은 save_meal RPC 한 번으로 원자적으로 처리한다 (중간에 실패하면 아무것도 안 쓰인다).
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic, animateNumber } from './ui.js';
import {
  todayLocal, shiftDay, formatWon, parseWon, dayName,
  MEAL_SLOTS, SLOT_LABEL, weekStart, weekDays, weekLabel, slotOfHour,
  cleanLines, dropEmptyFee, howNeedsShop, howHasFee, FEE_LABEL,
  buyTotal, buyAmount, mealAmount, sortMealBuys, buyItemTexts, tagColor,
  groupMealsBySlot, sumMeals, sumMealsByDate, sumMealsByHow, planMealSave, planMealDelete,
} from './calc.js';
import { fetchCategories, addCategory } from './categories.js';

const state = {
  start: '',          // 보고 있는 주의 월요일
  meals: [],          // 직전 주 + 이번 주 (한 번에 받아 온다)
  cats: [],
  profiles: [],
  userId: null,
  editing: null,      // 수정 중인 끼니, 새 항목이면 null
  placeId: null,
  sets: [],           // [{ key, id, howId, shop, txId, lines:[{name,amount}], picking }]
  openKey: null,      // 펼쳐진 세트의 key. null 이면 전부 접힘
  nextKey: 1,
};

let el = null;
let initialized = false;
let onTxChange = () => {}; // 가계부를 건드렸을 때 가계부·홈도 다시 그리게 알린다

export function init({ userId, onTxChange: cb }) {
  state.userId = userId;
  if (cb) onTxChange = cb;
  if (initialized) return;
  initialized = true;

  state.start = weekStart(todayLocal());

  el = {
    label: $('#meal-label'), prev: $('#meal-prev'), next: $('#meal-next'), thisWeek: $('#meal-this-week'),
    sum: $('#meal-sum'), sumPrev: $('#meal-sum-prev'), sumDiff: $('#meal-sum-diff'),
    onboard: $('#meal-onboard'), week: $('#meal-week'),
    catTotals: $('#meal-cat-totals'), catList: $('#meal-cat-list'),
    sheet: $('#sheet-meal'), form: $('#meal-form'), id: $('#meal-id'), date: $('#meal-date'),
    menu: $('#meal-menu'), who: $('#meal-who'),
    places: $('#meal-places'), newPlaceRow: $('#meal-new-place-row'),
    newPlace: $('#meal-new-place'), newPlaceOk: $('#meal-new-place-ok'),
    total: $('#meal-total'), sets: $('#meal-sets'), setAdd: $('#meal-set-add'),
    catWarn: $('#meal-cat-warn'), save: $('#meal-save'), del: $('#meal-delete'),
  };

  bindSheetBackdrop(el.sheet);
  el.prev.addEventListener('click', () => moveWeek(-1));
  el.next.addEventListener('click', () => moveWeek(1));
  el.thisWeek.addEventListener('click', () => {
    state.start = weekStart(todayLocal());
    refresh();
  });
  el.week.addEventListener('click', onWeekClick);

  el.places.addEventListener('click', onPlaceClick);
  el.newPlaceOk.addEventListener('click', createPlace);
  el.newPlace.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); createPlace(); }
  });

  el.setAdd.addEventListener('click', addSet);
  el.sets.addEventListener('click', onSetsClick);
  el.sets.addEventListener('input', onSetsInput);
  el.sets.addEventListener('keydown', onSetsKeydown);

  el.menu.addEventListener('input', updateSaveState);
  el.form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  el.del.addEventListener('click', remove);
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

function moveWeek(delta) {
  state.start = shiftDay(state.start, delta * 7);
  refresh();
}

const sheetOpen = () => el.sheet.classList.contains('open');

export async function refresh() {
  // 시트를 열어 둔 동안에는 다시 그리지 않는다 (상대가 저장하면 입력 중이던 값이 날아간다).
  if (sheetOpen()) return;

  const days = weekDays(state.start);
  const from = shiftDay(state.start, -7); // 직전 주까지 한 번에 받아 비교에 쓴다
  try {
    const [cats, profiles, meals] = await Promise.all([
      fetchCategories(),
      sb.from('profiles').select('id,name,color').then(unwrap),
      sb
        .from('meals')
        .select(`id, date, slot, menu, eater, place_id, created_at, created_by,
                 buys:meal_buys(id, how_id, shop, lines, transaction_id, sort_order, created_at,
                                tx:transactions(id, kind, amount, date, category_id, memo))`)
        .gte('date', from)
        .lte('date', days[6])
        .order('date', { ascending: true })
        .order('created_at', { ascending: true })
        .then(unwrap),
    ]);
    state.cats = cats;
    state.profiles = profiles;
    state.meals = meals.map((m) => ({ ...m, buys: sortMealBuys(m.buys) }));
    render();
  } catch (err) {
    console.error(err);
    el.week.innerHTML = needsSql(err)
      ? `<p class="empty">식비 표가 아직 준비되지 않았어요.<br>Supabase SQL Editor 에서<br><code>schema.sql</code> 의 23번 섹션을 실행해 주세요.</p>`
      : `<div class="retry">불러오지 못했어요<br>
          <button type="button" class="btn small" data-retry>다시 시도</button>
        </div>`;
  }
}

// 아직 SQL 을 실행하지 않은 상태인지. 표가 없을 때(PGRST205)와 관계가 없을 때(PGRST200) 둘 다.
function needsSql(err) {
  const m = `${err?.message ?? ''} ${err?.code ?? ''}`;
  return /does not exist|could not find the table|could not find a relationship|42P01|PGRST205|PGRST200/i.test(m);
}

const catsOf = (kind) => state.cats.filter((c) => c.kind === kind);
const nameOf = (id) => state.cats.find((c) => c.id === id)?.name ?? '';

// ---- 주간 화면 -------------------------------------------------------------

function render() {
  const days = weekDays(state.start);
  const prevStart = shiftDay(state.start, -7);
  const week = state.meals.filter((m) => m.date >= state.start && m.date <= days[6]);
  const prev = state.meals.filter((m) => m.date >= prevStart && m.date < state.start);

  el.label.textContent = weekLabel(state.start);
  el.thisWeek.hidden = state.start === weekStart(todayLocal());

  const sum = sumMeals(week);
  const diff = sum.total - sumMeals(prev).total;
  animateNumber(el.sum, sum.total, formatWon);
  animateNumber(el.sumPrev, sumMeals(prev).total, formatWon);
  animateNumber(el.sumDiff, diff, (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatWon(Math.abs(n))}`);
  el.sumDiff.classList.toggle('income', diff < 0); // 덜 썼으면 파랑

  el.onboard.hidden = week.length > 0;

  const byDate = sumMealsByDate(week);
  const grouped = groupMealsBySlot(week);
  const who = new Map(state.profiles.map((p) => [p.id, p]));
  const today = todayLocal();
  let i = 0;

  el.week.innerHTML = days
    .map((date) => {
      const total = byDate.get(date) ?? 0;
      const body = MEAL_SLOTS.map((slot) => {
        const items = grouped.get(`${date}|${slot}`) ?? [];
        if (!items.length) return emptyRow(date, slot, i++);
        return items.map((m, k) => mealRow(m, slot, k === 0, k === items.length - 1, who, i++)).join('');
      }).join('');
      return `
        <div class="card day-card">
          <div class="day-head">
            <span>${dayName(date)} ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}${date === today ? ' · 오늘' : ''}</span>
            <span class="sub">${total ? formatWon(total) : ''}</span>
          </div>
          ${body}
        </div>`;
    })
    .join('');

  const byHow = sumMealsByHow(week, state.cats);
  el.catTotals.hidden = !week.length;
  el.catList.innerHTML = byHow
    .map((c) => `<li><span>${escapeHtml(c.name)}</span><span>${c.total ? formatWon(c.total) : `${c.count}건`}</span></li>`)
    .join('');
}

function mealRow(m, slot, first, last, who, i) {
  const amount = mealAmount(m);
  const title = (m.menu || m.buys.flatMap((b) => cleanLines(b.lines).map((l) => l.name)).filter(Boolean).join(', ') || '기록').trim();
  const place = nameOf(m.place_id);
  const p = m.eater ? who.get(m.eater) : null;
  // 각자 먹은 끼니는 행이 둘이 되므로 끼니 이름을 둘 다 보여 준다 (한쪽만 비면 이름만 뜬 것처럼 보인다).
  const whoTag = m.eater
    ? `<span class="tag who" style="${tint(p?.color ?? '#888')}">${escapeHtml(p?.name ?? '혼자')}</span>`
    : '<span class="tag who">같이</span>';
  const buys = m.buys
    .map((b) => {
      const how = nameOf(b.how_id) || '어떻게?';
      const at = catsOf('meal_how').findIndex((c) => c.id === b.how_id);
      const shop = b.shop?.trim();
      const items = buyItemTexts(b.lines)
        .map((l) => `<span class="buy-item"><span class="nm">${escapeHtml(l.name)}</span><span class="pr">${escapeHtml(l.price)}</span></span>`)
        .join('');
      return `
        <div class="meal-buy">
          <span class="tag how" style="${tint(tagColor(at))}">${escapeHtml(how)}</span>
          <span class="buy-items">${shop ? `<span class="shop">${escapeHtml(shop)}</span>` : ''}${items}</span>
        </div>`;
    })
    .join('');
  return `
    <div class="tx-row meal-row" data-id="${m.id}" style="--i:${Math.min(i, 12)}">
      <div class="meal-slot">
        <span class="slot-name">${SLOT_LABEL[slot] ?? ''}</span>
        ${whoTag}
      </div>
      <div class="tx-main">
        <div class="meal-head">
          <span class="tx-cat">${escapeHtml(title)}</span>
          ${place ? `<span class="tag">${escapeHtml(place)}</span>` : ''}
          <span class="tx-amount">${amount ? formatWon(amount) : ''}</span>
        </div>
        ${buys}
      </div>
      ${last
        ? `<button type="button" class="icon-btn slot-add" data-date="${m.date}" data-slot="${slot}" aria-label="${SLOT_LABEL[slot]}에 하나 더">＋</button>`
        : '<span class="slot-add" aria-hidden="true"></span>'}
    </div>`;
}

// 뱃지: 그 색을 옅게 깐 배경 + 진한 글자. 라이트·다크 둘 다에서 읽힌다.
function tint(color) {
  const c = escapeHtml(color);
  return `background:color-mix(in srgb, ${c} 15%, transparent); color:${c}`;
}

function emptyRow(date, slot, i) {
  return `
    <div class="tx-row meal-row empty-slot" data-date="${date}" data-slot="${slot}" style="--i:${Math.min(i, 12)}">
      <div class="meal-slot"><span class="slot-name">${SLOT_LABEL[slot]}</span></div>
      <div class="tx-main muted">＋ 기록</div>
      <span class="slot-add" aria-hidden="true"></span>
    </div>`;
}

function onWeekClick(e) {
  if (e.target.closest('[data-retry]')) { refresh(); return; }
  const add = e.target.closest('.slot-add');
  if (add?.dataset.date) { openMealSheet(null, { date: add.dataset.date, slot: add.dataset.slot }); return; }
  const empty = e.target.closest('.empty-slot');
  if (empty) { openMealSheet(null, { date: empty.dataset.date, slot: empty.dataset.slot }); return; }
  const row = e.target.closest('.meal-row');
  if (row?.dataset.id) openMealSheet(state.meals.find((m) => m.id === Number(row.dataset.id)));
}

// ---- 입력 시트 ------------------------------------------------------------

export function openNew() {
  const today = todayLocal();
  const days = weekDays(state.start);
  const date = days.includes(today) ? today : state.start;
  const from = date === today ? slotOfHour(new Date().getHours()) : 'breakfast';
  openMealSheet(null, { date, slot: firstFreeSlot(date, from) });
}

// from 부터 돌면서 비어 있는 첫 끼니. 다 차 있으면 from 그대로.
function firstFreeSlot(date, from) {
  const grouped = groupMealsBySlot(state.meals);
  const at = MEAL_SLOTS.indexOf(from);
  const order = [...MEAL_SLOTS.slice(at), ...MEAL_SLOTS.slice(0, at)];
  return order.find((s) => !grouped.has(`${date}|${s}`)) ?? from;
}

function openMealSheet(m, preset = {}) {
  state.editing = m ?? null;

  el.id.value = m?.id ?? '';
  el.date.value = m?.date ?? preset.date ?? todayLocal();
  const slot = m?.slot ?? preset.slot ?? 'lunch';
  el.form.querySelector(`input[name="meal-slot"][value="${slot}"]`)?.setAttribute('checked', 'checked');
  el.form.querySelectorAll('input[name="meal-slot"]').forEach((r) => { r.checked = r.value === slot; });
  el.menu.value = m?.menu ?? '';

  state.placeId = m?.place_id ?? defaultPlaceId();
  state.nextKey = 1;
  state.sets = (m?.buys ?? []).map((b) => ({
    key: state.nextKey++,
    id: b.id,
    howId: b.how_id,
    shop: b.shop ?? '',
    txId: b.transaction_id,
    lines: cleanLines(b.lines),
    picking: false,
  }));
  state.openKey = null;

  renderWho(m?.eater ?? null);
  renderPlaces();
  renderSets();
  el.del.hidden = !m;
  el.newPlaceRow.hidden = true;
  el.newPlace.value = '';
  el.catWarn.hidden = state.cats.some((c) => c.kind === 'expense' && c.name === '식비');
  updateSaveState();

  openSheet(el.sheet);
  if (!m) setTimeout(() => el.menu.focus(), 250);
}

// 할일·일정·고정비의 '누구' 라디오와 같은 패턴. 앞머리만 '같이'.
function renderWho(selected) {
  const options = [{ id: '', name: '같이' }, ...state.profiles];
  el.who.innerHTML = options
    .map(
      (o) => `<label><input type="radio" name="meal-who" value="${o.id}"${String(selected ?? '') === String(o.id) ? ' checked' : ''}><span>${escapeHtml(o.name)}</span></label>`,
    )
    .join('');
}

function defaultPlaceId() {
  const places = catsOf('meal_where');
  return (places.find((c) => c.name === '집') ?? places[0])?.id ?? null;
}

function renderPlaces() {
  el.places.innerHTML = catsOf('meal_where')
    .map((c) => `<button type="button" class="chip ${c.id === state.placeId ? 'selected' : ''}" data-id="${c.id}">${escapeHtml(c.name)}</button>`)
    .join('') + '<button type="button" class="chip add" data-add>＋</button>';
}

function onPlaceClick(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  if (chip.dataset.add !== undefined) {
    el.newPlaceRow.hidden = false;
    el.newPlace.focus();
    return;
  }
  state.placeId = Number(chip.dataset.id);
  renderPlaces();
}

async function createPlace() {
  const name = el.newPlace.value;
  if (!name.trim()) return;
  try {
    const created = await addCategory(name, 'meal_where', state.cats);
    state.cats = await fetchCategories();
    state.placeId = created.id;
    el.newPlace.value = '';
    el.newPlaceRow.hidden = true;
    renderPlaces();
  } catch (err) {
    console.error(err);
    toast('장소를 추가하지 못했어요');
  }
}

// ---- 세트(어떻게 + 품목들) --------------------------------------------------

function addSet() {
  commitOpenSet();
  const key = state.nextKey++;
  state.sets.push({ key, id: null, howId: null, shop: '', txId: null, lines: [], picking: true });
  state.openKey = key;
  renderSets();
  el.sets.querySelector(`[data-key="${key}"]`)?.scrollIntoView({ block: 'nearest' });
}

function renderSets() {
  el.sets.innerHTML = state.sets.map((s) => (s.key === state.openKey ? openSetHtml(s) : collapsedSetHtml(s))).join('');
  recalcSums();
  updateSaveState();
}

function openSetHtml(s) {
  if (s.picking || !s.howId) {
    return `
      <div class="meal-set" data-key="${s.key}">
        <div class="chips">
          ${catsOf('meal_how').map((c) => `<button type="button" class="chip ${c.id === s.howId ? 'selected' : ''}" data-act="pick" data-id="${c.id}">${escapeHtml(c.name)}</button>`).join('')}
        </div>
      </div>`;
  }
  const how = nameOf(s.howId);
  const fee = howHasFee(how) ? (s.lines.find((l) => l.name === FEE_LABEL) ?? { name: FEE_LABEL, amount: 0 }) : null;
  const items = s.lines.filter((l) => l.name !== FEE_LABEL);
  const rows = [...items, { name: '', amount: 0 }]; // 맨 끝에는 항상 빈 줄
  return `
    <div class="meal-set" data-key="${s.key}">
      <div class="row">
        <div class="chips"><button type="button" class="chip selected" data-act="repick">${escapeHtml(how)} ▾</button></div>
        <span class="set-sum muted">${buyTotal(s) ? formatWon(buyTotal(s)) : ''}</span>
        <button type="button" class="icon-btn" data-act="del-set" aria-label="이 세트 지우기">✕</button>
      </div>
      ${howNeedsShop(how)
        ? `<input type="text" data-role="shop" placeholder="가게 이름 (예: ○○반점)" maxlength="40" autocomplete="off" value="${escapeHtml(s.shop ?? '')}">`
        : ''}
      <div class="set-items">
        ${rows.map((l, k) => itemRowHtml(l, k === rows.length - 1)).join('')}
        ${fee ? itemRowHtml(fee, true, true) : ''}
      </div>
    </div>`;
}

// fixed = 배달료처럼 이름이 고정된 줄. 이름 칸은 읽기 전용이고 지울 수 없다.
function itemRowHtml(line, last, fixed = false) {
  return `
    <div class="row">
      <input type="text" data-role="name" placeholder="품목 (선택)" maxlength="40" autocomplete="off"
             enterkeyhint="next" value="${escapeHtml(line.name ?? '')}"${fixed ? ' readonly' : ''}>
      <input type="text" data-role="price" class="price" inputmode="numeric" placeholder="0" autocomplete="off"
             enterkeyhint="next" value="${line.amount ? formatWon(line.amount) : ''}">
      <button type="button" class="icon-btn" data-act="del-item" aria-label="이 품목 지우기"${last || fixed ? ' style="visibility:hidden"' : ''}>✕</button>
    </div>`;
}

function collapsedSetHtml(s) {
  const names = cleanLines(dropEmptyFee(s.lines)).map((l) => l.name).filter(Boolean);
  const sub = s.shop?.trim() || (names.length > 1 ? `${names[0]} 외 ${names.length - 1}` : names[0] ?? '');
  return `
    <div class="tx-row meal-row" data-key="${s.key}" data-act="open-set">
      <div class="tx-main">
        <div class="tx-cat">${escapeHtml(nameOf(s.howId) || '어떻게?')}</div>
        ${sub ? `<div class="tx-memo">${escapeHtml(sub)}</div>` : ''}
      </div>
      <div class="tx-amount">${buyTotal(s) ? formatWon(buyTotal(s)) : ''}</div>
      <button type="button" class="icon-btn" data-act="del-set" aria-label="이 세트 지우기">✕</button>
    </div>`;
}

// 펼친 세트의 입력칸 값을 state 로 옮긴다. 구조가 바뀌기 전에 반드시 부른다.
function commitOpenSet() {
  const box = el.sets.querySelector(`.meal-set[data-key="${state.openKey}"]`);
  if (!box) return;
  const s = state.sets.find((x) => x.key === state.openKey);
  if (!s) return;
  s.shop = box.querySelector('[data-role="shop"]')?.value ?? s.shop ?? '';
  s.lines = [...box.querySelectorAll('.set-items .row')].map((row) => ({
    name: row.querySelector('[data-role="name"]').value,
    amount: parseWon(row.querySelector('[data-role="price"]').value),
  }));
}

function onSetsClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const key = Number(e.target.closest('[data-key]')?.dataset.key);
  const s = state.sets.find((x) => x.key === key);

  if (act === 'del-item') {
    commitOpenSet();
    const rows = [...e.target.closest('.set-items').children];
    s.lines.splice(rows.indexOf(e.target.closest('.row')), 1);
    renderSets();
    return;
  }
  if (act === 'del-set') {
    if (s.txId && !confirmDialog(`이 지출을 지우면 가계부의 ${formatWon(buyTotal(s))}원도 함께 사라져요. 지울까요?`)) return;
    if (state.openKey === key) state.openKey = null;
    else commitOpenSet();
    state.sets = state.sets.filter((x) => x.key !== key);
    renderSets();
    return;
  }
  if (act === 'pick') {
    s.howId = Number(e.target.closest('[data-id]').dataset.id);
    s.picking = false;
    renderSets();
    const box = el.sets.querySelector(`[data-key="${key}"]`);
    (box?.querySelector('[data-role="shop"]') ?? box?.querySelector('[data-role="name"]'))?.focus();
    return;
  }
  if (act === 'repick') { s.picking = true; renderSets(); return; }
  if (act === 'open-set') {
    commitOpenSet();
    state.openKey = key;
    renderSets();
  }
}

// 타이핑 중에는 다시 그리지 않는다 — 포커스와 캐럿을 지키려고 DOM 을 직접 손본다.
function onSetsInput(e) {
  const input = e.target;
  if (input.dataset.role === 'price') {
    const n = parseWon(input.value);
    input.value = n ? formatWon(n) : '';
  }
  const items = input.closest('.set-items');
  const lastFree = [...(items?.children ?? [])].filter((r) => !r.querySelector('[readonly]')).at(-1);
  if (items && input.closest('.row') === lastFree && (input.value.trim() || parseWon(input.value))) {
    lastFree.insertAdjacentHTML('afterend', itemRowHtml({ name: '', amount: 0 }, true));
    lastFree.querySelector('[data-act="del-item"]').style.visibility = '';
  }
  commitOpenSet();
  recalcSums();
  updateSaveState();
}

// 폼 안의 Enter 는 암시적 제출이라 그냥 두면 저장이 눌린다. 다음 칸으로 넘긴다.
function onSetsKeydown(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const row = e.target.closest('.row');
  if (e.target.dataset.role === 'name') { row.querySelector('[data-role="price"]').focus(); return; }
  const next = row.nextElementSibling;
  if (next) next.querySelector('[data-role="name"]').focus();
}

function recalcSums() {
  let total = 0;
  for (const s of state.sets) {
    const t = buyTotal(s);
    total += t;
    const box = el.sets.querySelector(`[data-key="${s.key}"]`);
    const out = box?.querySelector('.set-sum') ?? box?.querySelector('.tx-amount');
    if (out) out.textContent = t ? formatWon(t) : '';
  }
  el.total.textContent = total ? formatWon(total) : '';
}

// ---- 저장·삭제 ------------------------------------------------------------

function readSheet() {
  commitOpenSet();
  return {
    date: el.date.value,
    slot: el.form.querySelector('input[name="meal-slot"]:checked')?.value ?? 'lunch',
    menu: el.menu.value,
    eater: el.form.querySelector('input[name="meal-who"]:checked')?.value || null, // '' → null (uuid 컬럼)
    placeId: state.placeId,
    buys: state.sets.map((s) => ({
      id: s.id, howId: s.howId, shop: s.shop ?? '', transactionId: s.txId, lines: dropEmptyFee(s.lines),
    })),
  };
}

function updateSaveState() {
  const hasSet = state.sets.some((s) => s.howId && (cleanLines(dropEmptyFee(s.lines)).length || s.shop?.trim()));
  el.save.disabled = !(el.menu.value.trim() || hasSet);
}

async function save() {
  const input = readSheet();
  if (!input.menu.trim() && !input.buys.some((b) => cleanLines(b.lines).length || b.shop.trim())) return;

  el.save.disabled = true;
  try {
    unwrap(await sb.rpc('save_meal', { p: planMealSave(state.editing, input, state.cats) }));
    haptic();
    closeSheet(el.sheet);
    state.start = weekStart(input.date); // 저장한 날이 든 주로 옮긴다
    await refresh();
    onTxChange();
  } catch (err) {
    console.error(err);
    toast(needsSql(err) ? 'SQL 의 23번 섹션을 먼저 실행해 주세요' : '저장에 실패했어요. 다시 시도해 주세요');
  } finally {
    el.save.disabled = false;
  }
}

async function remove() {
  if (!state.editing) return;
  const { mealId, txIds } = planMealDelete(state.editing);
  const amount = mealAmount(state.editing);
  const msg = txIds.length
    ? `이 기록을 지우면 가계부의 ${txIds.length}건 ${formatWon(amount)}원도 함께 사라져요. 지울까요?`
    : '이 기록을 지울까요?';
  if (!confirmDialog(msg)) return;
  try {
    // 세트는 cascade 로, 거래는 meal_buys 삭제 트리거로 함께 지워진다.
    unwrap(await sb.from('meals').delete().eq('id', mealId));
    closeSheet(el.sheet);
    await refresh();
    if (txIds.length) onTxChange();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
}
