// 식비 탭: 한 주(월~일)의 아침·점심·저녁·야식 식단.
// 한 끼 = 날짜·끼니·메뉴·누가·어디서 하나씩 + '어떻게' 세트 0..N.
// 세트 하나가 가계부 거래 한 건과 연결된다. 품목 가격이 원본이고 거래에는 그 합계가 들어간다.
// 저장은 save_meal RPC 한 번으로 원자적으로 처리한다 (중간에 실패하면 아무것도 안 쓰인다).
//
// '사 둔 것'(js/pantry.js 탭): 미리 담아 둔 품목을 세트에서 드롭다운으로 꺼낸다.
// 담을 때는 가계부에 안 들어가고, 그 끼니에서 **쓴 개수만큼만** 값이 실린다
// (4개에 10,000원이면 한 개에 2,500원). 값은 calc.js 의 pantryShare 가 매긴다.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic, animateNumber } from './ui.js';
import {
  todayLocal, shiftDay, formatWon, dayName,
  MEAL_SLOTS, SLOT_LABEL, weekStart, weekDays, weekLabel, slotOfHour,
  cleanLines, dropEmptyFee, howNeedsShop, howHasFee, FEE_LABEL,
  buyTotal, buyAmount, mealAmount, sortMealBuys, buyItemTexts, tagColor,
  groupMealsBySlot, sumMeals, sumMealsByDate, sumMealsByHow, planMealSave, planMealDelete,
  pantryLine, pantryChoices, pantryOptionLabel, usedPantryIds, pantryUsedLabel, pantryNextUsed,
  pantryShare, pantryLeftOf,
} from './calc.js';
import { fetchCategories, addCategory } from './categories.js';
import * as pantry from './pantry.js';
import { itemRowHtml, growItemRows, readFreeRow, onItemRowsKeydown } from './itemrow.js';

const state = {
  start: '',          // 보고 있는 주의 월요일
  meals: [],          // 직전 주 + 이번 주 (한 번에 받아 온다)
  cats: [],
  profiles: [],
  userId: null,
  editing: null,      // 수정 중인 끼니, 새 항목이면 null
  placeId: null,
  menuAuto: '',       // 장소를 고르며 우리가 채워 넣은 메뉴. 직접 쓴 것과 구분하려고 들고 있는다.
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
  el.sets.addEventListener('change', onSetsChange);
  el.sets.addEventListener('keydown', (e) => {
    if (e.target.dataset.role !== 'new-how') { onItemRowsKeydown(e); return; }
    if (e.key === 'Enter') { e.preventDefault(); createHow(Number(e.target.closest('[data-key]').dataset.key)); }
  });

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
      pantry.load(), // 세트 드롭다운이 최신 목록을 보도록 같이 받는다
    ]);
    state.cats = cats;
    state.profiles = profiles;
    state.meals = meals.map((m) => ({ ...m, buys: sortMealBuys(m.buys) }));
    render();
    pantry.redraw(); // 위 pantry.load() 로 받아 온 남은 개수를 사 둔 것 목록에도 반영한다
  } catch (err) {
    console.error(err);
    el.week.innerHTML = needsSql(err)
      ? `<p class="empty">식비 표가 아직 준비되지 않았어요.<br>Supabase SQL Editor 에서<br><code>schema.sql</code> 전체를 한 번 실행해 주세요.</p>`
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
      const items = buyItemTexts(b.lines, qtyOfPantry)
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
  state.menuAuto = '';

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
  applyAutoMenu();
}

// 메뉴가 뻔한 장소. 여기에 적어 두면 장소를 고를 때 메뉴가 저절로 들어간다.
const AUTO_MENU = { 회사: '회사밥' };

// 직접 적은 메뉴는 건드리지 않는다. 비어 있거나, 앞서 우리가 넣어 둔
// 값 그대로일 때만 새 장소에 맞춰 바꾼다.
function applyAutoMenu() {
  const next = AUTO_MENU[nameOf(state.placeId)] ?? '';
  const cur = el.menu.value.trim();
  if (cur && cur !== state.menuAuto) return;
  el.menu.value = next;
  state.menuAuto = next;
  updateSaveState();
}

// 목록에 없는 곳을 그 자리에서 만들어 바로 고른 상태로 둔다.
async function createHow(key) {
  const s = state.sets.find((x) => x.key === key);
  const input = el.sets.querySelector(`[data-key="${key}"] [data-role="new-how"]`);
  const name = input?.value ?? '';
  if (!s || !name.trim()) return;
  try {
    const created = await addCategory(name, 'meal_how', state.cats);
    state.cats = await fetchCategories();
    s.howId = created.id;
    s.picking = false;
    s.addingHow = false;
    renderSets();
  } catch (err) {
    console.error(err);
    toast('산 곳을 추가하지 못했어요');
  }
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
    applyAutoMenu();
  } catch (err) {
    console.error(err);
    toast('장소를 추가하지 못했어요');
  }
}

// ---- 세트(어떻게 + 품목들) --------------------------------------------------

function addSet() {
  commitOpenSet();
  // 아직 아무것도 안 고른 세트가 있으면 새로 만들지 않고 그걸 다시 연다.
  // (고르는 화면에서 ＋ 를 또 누르면 빈 '어떻게?' 칸만 쌓였다.)
  const blank = state.sets.find((x) => !x.howId);
  if (blank) {
    blank.picking = true;
    state.openKey = blank.key;
    renderSets();
    el.sets.querySelector(`[data-key="${blank.key}"]`)?.scrollIntoView({ block: 'nearest' });
    return;
  }
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

// 이름도 값도 없는 줄 (맨 끝에 늘 놓이는 입력용 빈 줄).
const isBlankLine = (l) => !String(l?.name ?? '').trim() && !(Number(l?.amount) > 0) && !l?.pantry_id;

function openSetHtml(s) {
  if (s.picking || !s.howId) {
    const hows = catsOf('meal_how');
    // 칩만 덩그러니 나오면 뭘 하라는 건지 알 수 없다. 한 줄 물어보고 시작한다.
    return `
      <div class="meal-set" data-key="${s.key}">
        <div class="row">
          <div class="field-label">어떻게 샀어요?</div>
          <button type="button" class="icon-btn" data-act="del-set" aria-label="그만두기">✕</button>
        </div>
        <div class="chips">
          ${hows.map((c) => `<button type="button" class="chip ${c.id === s.howId ? 'selected' : ''}" data-act="pick" data-id="${c.id}">${escapeHtml(c.name)}</button>`).join('')}
          <button type="button" class="chip add" data-act="new-how">＋</button>
        </div>
        ${s.addingHow
          ? `<div class="row" style="margin-top:8px">
          <input type="text" data-role="new-how" placeholder="새 이름 (예: 이마트)" maxlength="20" autocomplete="off">
          <button type="button" class="btn small" data-act="new-how-ok">추가</button>
        </div>`
          : ''}
      </div>`;
  }
  const how = nameOf(s.howId);
  const fee = howHasFee(how) ? (s.lines.find((l) => l.name === FEE_LABEL) ?? { name: FEE_LABEL, amount: 0 }) : null;
  // commitOpenSet 이 DOM 에서 읽어 온 줄에는 맨 끝 빈 줄도 섞여 있다. 여기서 걸러 내지 않으면
  // 다시 그릴 때마다 빈 줄이 하나씩 쌓인다 (남김↔다 씀 을 누를 때마다 늘어났다).
  const items = s.lines.filter((l) => l.name !== FEE_LABEL && !isBlankLine(l));
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
        ${rows.map((l, k) => setRowHtml(l, { last: k === rows.length - 1 })).join('')}
        ${fee ? setRowHtml(fee, { last: true, fixed: true }) : ''}
      </div>
      ${pantrySelectHtml(s)}
    </div>`;
}

// 그 카테고리에 담아 둔 게 있을 때만 드롭다운이 나온다.
function pantrySelectHtml(s) {
  const choices = pantryChoices(pantry.items(), {
    howId: s.howId,
    usedIds: usedPantryIds(state.sets),
    buyId: s.id,
  });
  if (!choices.length) return '';
  return `
    <select data-role="pantry" aria-label="사 둔 것에서 가져오기">
      <option value="">＋ 사 둔 것에서 가져오기</option>
      ${choices.map((c) => `<option value="${c.id}">${escapeHtml(pantryOptionLabel(c, s.id))}</option>`).join('')}
    </select>`;
}

// 세트의 품목 줄. 사 둔 것에서 꺼낸 줄만 모양이 다르고 나머지는 공용 편집기가 그린다.
const setRowHtml = (line, opts) => (line.pantry_id ? pantryItemRowHtml(line) : itemRowHtml(line, opts));

// 그 품목을 몇 개 샀는지 (사 둔 것 목록이 원본).
const qtyOfPantry = (id) => Math.max(1, Number(pantry.items().find((p) => p.id === id)?.qty) || 1);

// 이 끼니 말고 다른 끼니들이 이미 쓴 개수.
// 목록의 남은 개수에는 지금 고치고 있는 끼니가 쓴 몫도 이미 빠져 있다. 그대로 쓰면
// 제 몫을 두 번 세게 되므로, 저장돼 있던 만큼을 도로 더해서 뺀다.
function usedByOthers(pantryId) {
  const item = pantry.items().find((p) => p.id === pantryId);
  if (!item) return 0;
  const all = qtyOfPantry(pantryId) - pantryLeftOf(item);
  let mine = 0;
  for (const b of state.editing?.buys ?? []) {
    for (const l of b.lines ?? []) {
      if (Math.trunc(Number(l?.pantry_id) || 0) === pantryId) mine += Math.max(0, Number(l.used) || 0);
    }
  }
  return Math.max(0, all - mine);
}

// 쓴 개수에 맞춰 값을 다시 매긴다. used 가 바뀔 때마다 불러야 한다.
function repricePantryLine(line, buyId = null) {
  const id = Math.trunc(Number(line?.pantry_id) || 0);
  const item = id > 0 ? pantry.items().find((p) => p.id === id) : null;
  if (!item) return line;
  return { ...line, amount: pantryShare(item, { before: usedByOthers(id), used: line.used, buyId }) };
}

// 사 둔 것에서 꺼낸 줄. 이름·가격은 그 품목의 것이라 여기서 못 고치고, 몇 개 끝냈는지만 누른다.
// 한 개짜리면 예전 그대로 남김 ↔ 다 씀 이고, 여러 개면 남김 → 1개 → 2개 → 다 씀 으로 돈다.
// 값은 칸이 아니라 꼬리표(data-*)에 둔다 — 읽기 전용 칸을 흉내 내는 것보다 읽기가 쉽다.
function pantryItemRowHtml(line) {
  const qty = qtyOfPantry(line.pantry_id);
  const used = Math.max(0, Number(line.used) || 0);
  const legacy = (pantry.items().find((p) => p.id === line.pantry_id)?.charged_buy_id ?? null) !== null;
  return `
    <div class="row pantry-line" data-pantry="${line.pantry_id}" data-used="${used}"
         data-name="${escapeHtml(line.name ?? '')}" data-amount="${Number(line.amount) || 0}">
      <span class="nm">${escapeHtml(line.name ?? '')}</span>
      <span class="pr">${line.amount ? `${formatWon(line.amount)}원` : (legacy ? '이미 냄' : '0원')}</span>
      <button type="button" class="chip mini${used ? ' selected' : ''}" data-act="toggle-done">${escapeHtml(pantryUsedLabel(used, qty))}</button>
      <button type="button" class="icon-btn" data-act="del-item" aria-label="이 품목 빼기">✕</button>
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
  s.lines = [...box.querySelectorAll('.set-items .row')].map(readItemRow);
}

function readItemRow(row) {
  if (!row.dataset.pantry) return readFreeRow(row);
  // 사 둔 것 줄은 칸이 없다 — 값을 꼬리표에서 읽는다.
  const id = Number(row.dataset.pantry);
  const used = Math.max(0, Number(row.dataset.used) || 0);
  const item = pantry.items().find((p) => p.id === id);
  const s = state.sets.find((x) => x.key === state.openKey);
  return {
    name: row.dataset.name,
    amount: item
      ? pantryShare(item, { before: usedByOthers(id), used, buyId: s?.id ?? null })
      : Number(row.dataset.amount) || 0,
    pantry_id: id,
    used,
  };
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
  if (act === 'toggle-done') {
    commitOpenSet();
    const rows = [...e.target.closest('.set-items').children];
    const i = rows.indexOf(e.target.closest('.row'));
    const line = s.lines[i];
    s.lines[i] = repricePantryLine(
      { ...line, used: pantryNextUsed(line.used, qtyOfPantry(line.pantry_id)) },
      s.id ?? null,
    );
    haptic();
    renderSets();
    return;
  }
  if (act === 'new-how') {
    s.addingHow = true;
    renderSets();
    el.sets.querySelector(`[data-key="${key}"] [data-role="new-how"]`)?.focus();
    return;
  }
  if (act === 'new-how-ok') { createHow(key); return; }
  if (act === 'repick') { s.picking = true; s.addingHow = false; renderSets(); return; }
  if (act === 'open-set') {
    commitOpenSet();
    state.openKey = key;
    renderSets();
  }
}

function onSetsInput(e) {
  if (e.target.dataset.role === 'pantry') return; // 드롭다운은 change 에서 다룬다
  growItemRows(e.target);
  commitOpenSet();
  recalcSums();
  updateSaveState();
}

// 드롭다운에서 사 둔 것을 고르면 그 줄을 세트 맨 밑에 붙인다.
function onSetsChange(e) {
  const sel = e.target;
  if (sel.dataset.role !== 'pantry') return;
  const id = Number(sel.value);
  sel.value = '';
  const s = state.sets.find((x) => x.key === Number(sel.closest('[data-key]')?.dataset.key));
  const item = pantry.items().find((p) => p.id === id);
  if (!s || !item) return;
  commitOpenSet();
  s.lines = [...cleanLines(s.lines), pantryLine(item, s.id)];
  haptic();
  renderSets();
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
    toast(needsSql(err) ? 'schema.sql 전체를 한 번 실행해 주세요' : '저장에 실패했어요. 다시 시도해 주세요');
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
