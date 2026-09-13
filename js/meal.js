// 식비 탭: 한 주(월~일)의 아침·점심·저녁·야식 식단.
// 한 끼 = 날짜·끼니·메뉴·누가·어디서 하나씩 + '어떻게' 세트 0..N.
// 세트 하나가 가계부 거래 한 건과 연결된다. 품목 가격이 원본이고 거래에는 그 합계가 들어간다.
// 저장은 save_meal RPC 한 번으로 원자적으로 처리한다 (중간에 실패하면 아무것도 안 쓰인다).
//
// '사 둔 것'(pantry_items): 윙잇·컬리에서 시킨 품목을 미리 담아 두고 세트에서 드롭다운으로 꺼낸다.
// 담을 때는 가계부에 안 들어가고, 처음 꺼내 먹는 줄에만 값이 실린다. 또 먹으면 0원 줄로 붙는다.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic, animateNumber } from './ui.js';
import {
  todayLocal, shiftDay, formatWon, parseWon, dayName,
  MEAL_SLOTS, SLOT_LABEL, weekStart, weekDays, weekLabel, slotOfHour,
  cleanLines, dropEmptyFee, howNeedsShop, howHasFee, FEE_LABEL,
  buyTotal, buyAmount, mealAmount, sortMealBuys, buyItemTexts, tagColor,
  groupMealsBySlot, sumMeals, sumMealsByDate, sumMealsByHow, planMealSave, planMealDelete,
  pantryLine, pantryChoices, pantryOptionLabel, usedPantryIds, groupPantryByHow, pantryStats,
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
  pantry: [],         // 사 둔 것 (남은 것 전부 + 최근에 다 쓴 것)
  pantryError: null,  // 31번 SQL 을 아직 안 돌렸으면 여기 담긴다
  pantryDone: false,  // 다 쓴 것까지 펼쳐 볼지
  pantryEditing: null,
  pantryHowId: null,
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
    pantryCard: $('#meal-pantry'), pantryCount: $('#meal-pantry-count'), pantryList: $('#meal-pantry-list'),
    pantryAdd: $('#meal-pantry-add'), pantryDoneBtn: $('#meal-pantry-done'),
    pantryNote: $('#meal-pantry-note'), pantryNotice: $('#meal-pantry-notice'),
    pSheet: $('#sheet-pantry'), pForm: $('#pantry-form'), pHows: $('#pantry-hows'), pDate: $('#pantry-date'),
    pItems: $('#pantry-items'), pTotal: $('#pantry-total'), pCharged: $('#pantry-charged'),
    pSave: $('#pantry-save'), pDel: $('#pantry-delete'),
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
  el.sets.addEventListener('keydown', onSetsKeydown);

  bindSheetBackdrop(el.pSheet);
  el.pantryList.addEventListener('click', onPantryListClick);
  el.pantryAdd.addEventListener('click', () => openPantrySheet(null));
  el.pantryDoneBtn.addEventListener('click', () => { state.pantryDone = !state.pantryDone; renderPantry(); });
  el.pHows.addEventListener('click', onPantryHowClick);
  el.pItems.addEventListener('input', onPantryInput);
  el.pItems.addEventListener('click', onPantryItemsClick);
  el.pItems.addEventListener('keydown', onSetsKeydown);
  el.pForm.addEventListener('submit', (e) => { e.preventDefault(); savePantry(); });
  el.pDel.addEventListener('click', removePantry);

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

const sheetOpen = () => el.sheet.classList.contains('open') || el.pSheet.classList.contains('open');

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
      loadPantry(),
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

// 사 둔 것은 따로 받는다 — 31번 SQL 을 아직 안 돌린 사람도 식비 탭의 나머지는 멀쩡해야 한다.
async function loadPantry() {
  try {
    state.pantry = unwrap(
      await sb
        .from('pantry_items')
        .select('id,how_id,name,amount,bought_on,charged_buy_id,done')
        // 남은 것은 전부, 다 쓴 것은 최근 두 달치만 (목록이 끝없이 길어지지 않게).
        .or(`done.eq.false,bought_on.gte.${shiftDay(todayLocal(), -60)}`)
        .order('bought_on', { ascending: false })
        .order('id', { ascending: false }),
    );
    state.pantryError = null;
  } catch (err) {
    console.error(err);
    state.pantry = [];
    state.pantryError = err;
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
  renderPantry();

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
        ${rows.map((l, k) => itemRowHtml(l, { last: k === rows.length - 1 })).join('')}
        ${fee ? itemRowHtml(fee, { last: true, fixed: true }) : ''}
      </div>
      ${pantrySelectHtml(s)}
    </div>`;
}

// 그 카테고리에 담아 둔 게 있을 때만 드롭다운이 나온다.
function pantrySelectHtml(s) {
  const choices = pantryChoices(state.pantry, {
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

// fixed = 배달료처럼 이름이 고정된 줄. 이름 칸은 읽기 전용이고 지울 수 없다.
function itemRowHtml(line, { last = false, fixed = false, placeholder = '품목 (선택)' } = {}) {
  if (line.pantry_id) return pantryItemRowHtml(line);
  return `
    <div class="row">
      <input type="text" data-role="name" placeholder="${escapeHtml(placeholder)}" maxlength="40" autocomplete="off"
             enterkeyhint="next" value="${escapeHtml(line.name ?? '')}"${fixed ? ' readonly' : ''}>
      <input type="text" data-role="price" class="price" inputmode="numeric" placeholder="0" autocomplete="off"
             enterkeyhint="next" value="${line.amount ? formatWon(line.amount) : ''}">
      <button type="button" class="icon-btn" data-act="del-item" aria-label="이 품목 지우기"${last || fixed ? ' style="visibility:hidden"' : ''}>✕</button>
    </div>`;
}

// 사 둔 것에서 꺼낸 줄. 이름·가격은 그 품목의 것이라 여기서 못 고치고, 다 썼는지만 누른다.
// 값은 칸이 아니라 꼬리표(data-*)에 둔다 — 읽기 전용 칸을 흉내 내는 것보다 읽기가 쉽다.
function pantryItemRowHtml(line) {
  const done = line.done === true;
  return `
    <div class="row pantry-line" data-pantry="${line.pantry_id}" data-done="${done ? 1 : 0}"
         data-name="${escapeHtml(line.name ?? '')}" data-amount="${Number(line.amount) || 0}">
      <span class="nm">${escapeHtml(line.name ?? '')}</span>
      <span class="pr">${line.amount ? `${formatWon(line.amount)}원` : '이미 냄'}</span>
      <button type="button" class="chip mini${done ? ' selected' : ''}" data-act="toggle-done">${done ? '다 씀' : '남김'}</button>
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
  if (row.dataset.pantry) {
    return {
      name: row.dataset.name,
      amount: Number(row.dataset.amount) || 0,
      pantry_id: Number(row.dataset.pantry),
      done: row.dataset.done === '1',
    };
  }
  return {
    name: row.querySelector('[data-role="name"]').value,
    amount: parseWon(row.querySelector('[data-role="price"]').value),
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
    s.lines[i] = { ...s.lines[i], done: !s.lines[i].done };
    haptic();
    renderSets();
    return;
  }
  if (act === 'repick') { s.picking = true; renderSets(); return; }
  if (act === 'open-set') {
    commitOpenSet();
    state.openKey = key;
    renderSets();
  }
}

function onSetsInput(e) {
  if (e.target.dataset.role === 'pantry') return; // 드롭다운은 change 에서 다룬다
  editItemRow(e.target);
  commitOpenSet();
  recalcSums();
  updateSaveState();
}

// 직접 적는 줄만 '빈 줄'이 될 수 있다. 배달료(읽기 전용)도, 사 둔 것 줄(칸이 없다)도 아니다.
const isFreeRow = (row) => !!row.querySelector('[data-role="name"]:not([readonly])');

// 품목 줄 편집 공통(세트·사 둔 것 시트): 가격을 숫자로 다듬고,
// 마지막 빈 줄에 뭔가 적히면 그 아래 빈 줄을 하나 더 붙인다.
// 타이핑 중에는 다시 그리지 않는다 — 포커스와 캐럿을 지키려고 DOM 을 직접 손본다.
function editItemRow(input, placeholder) {
  if (input.dataset.role === 'price') {
    const n = parseWon(input.value);
    input.value = n ? formatWon(n) : '';
  }
  const items = input.closest('.set-items');
  const lastFree = [...(items?.children ?? [])].filter(isFreeRow).at(-1);
  if (items && input.closest('.row') === lastFree && (input.value.trim() || parseWon(input.value))) {
    lastFree.insertAdjacentHTML('afterend', itemRowHtml({ name: '', amount: 0 }, { last: true, placeholder }));
    lastFree.querySelector('[data-act="del-item"]').style.visibility = '';
  }
}

// 드롭다운에서 사 둔 것을 고르면 그 줄을 세트 맨 밑에 붙인다.
function onSetsChange(e) {
  const sel = e.target;
  if (sel.dataset.role !== 'pantry') return;
  const id = Number(sel.value);
  sel.value = '';
  const s = state.sets.find((x) => x.key === Number(sel.closest('[data-key]')?.dataset.key));
  const item = state.pantry.find((p) => p.id === id);
  if (!s || !item) return;
  commitOpenSet();
  s.lines = [...cleanLines(s.lines), pantryLine(item, s.id)];
  haptic();
  renderSets();
}

// 폼 안의 Enter 는 암시적 제출이라 그냥 두면 저장이 눌린다. 다음 칸으로 넘긴다.
// 다음 줄이 사 둔 것 줄이면 옮겨 갈 칸이 없다 — 그냥 제자리에 둔다.
function onSetsKeydown(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const row = e.target.closest('.row');
  if (e.target.dataset.role === 'name') { row.querySelector('[data-role="price"]').focus(); return; }
  row.nextElementSibling?.querySelector('[data-role="name"]')?.focus();
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

// ---- 사 둔 것 --------------------------------------------------------------
// 식비 탭의 카드(남은 것 목록)와 담기·고치기 시트.

const PANTRY_PLACEHOLDER = '품목 (예: 삼겹살)';

// 배달·포장·외식은 갈 때마다 가게가 달라 담아 둘 것이 없다. 나머지(윙잇·컬리·쿠팡·마트·편의점)만.
const pantryHows = () => catsOf('meal_how').filter((c) => !howNeedsShop(c.name));

const mdLabel = (date) => `${Number(String(date ?? '').slice(5, 7))}/${Number(String(date ?? '').slice(8, 10))}`;

function renderPantry() {
  if (state.pantryError) {
    el.pantryCard.hidden = true;
    el.pantryNotice.hidden = false;
    el.pantryNotice.innerHTML = needsSql(state.pantryError)
      ? `<p class="hint">'사 둔 것'을 쓰려면 Supabase SQL Editor 에서 <code>schema.sql</code> 의 31번 섹션을 한 번 실행해 주세요.</p>`
      : '<p class="hint">사 둔 것을 불러오지 못했어요.</p>';
    return;
  }
  el.pantryNotice.hidden = true;
  el.pantryCard.hidden = false;

  const stats = pantryStats(state.pantry);
  el.pantryCount.textContent = stats.left ? `${stats.left}개 남음` : '없음';
  el.pantryDoneBtn.hidden = !stats.done;
  el.pantryDoneBtn.textContent = state.pantryDone ? '다 쓴 것 접기' : `다 쓴 것 ${stats.done}개`;
  el.pantryNote.hidden = !stats.waiting;
  el.pantryNote.textContent = `${formatWon(stats.waiting)}원은 처음 꺼내 먹을 때 가계부에 들어가요`;

  const shown = state.pantry.filter((it) => !it.done || state.pantryDone);
  const groups = groupPantryByHow(shown, state.cats);
  el.pantryList.innerHTML = groups.length
    ? groups
        .map(
          (g) => `
        <div class="day-head"><span>${escapeHtml(g.name)}</span><span class="sub">${g.total ? formatWon(g.total) : ''}</span></div>
        ${g.items.map(pantryRowHtml).join('')}`,
        )
        .join('')
    : '<p class="hint">담아 둔 게 없어요. 윙잇·컬리에서 시킨 걸 담아 두면 식비에서 꺼내 쓸 수 있어요.</p>';
}

function pantryRowHtml(it) {
  return `
    <div class="tx-row pantry-row${it.done ? ' done' : ''}" data-pantry="${it.id}">
      <div class="tx-main">
        <div class="tx-cat">${escapeHtml(it.name)}</div>
        <div class="tx-memo">${mdLabel(it.bought_on)} 담음 · ${it.charged_buy_id ? '가계부에 들어감' : '아직 안 들어감'}</div>
      </div>
      <span class="tx-amount">${it.amount ? formatWon(it.amount) : ''}</span>
      <button type="button" class="chip mini${it.done ? ' selected' : ''}" data-act="toggle">${it.done ? '다 씀' : '남김'}</button>
    </div>`;
}

function onPantryListClick(e) {
  const row = e.target.closest('[data-pantry]');
  if (!row) return;
  const item = state.pantry.find((p) => p.id === Number(row.dataset.pantry));
  if (!item) return;
  if (e.target.closest('[data-act="toggle"]')) togglePantryDone(item);
  else openPantrySheet(item);
}

// 목록에서 바로 남김 ↔ 다 씀. 손으로 누른 것이라 어느 세트의 것도 아니게 둔다.
async function togglePantryDone(item) {
  const done = !item.done;
  item.done = done;
  renderPantry();
  if (done) haptic(15);
  try {
    unwrap(await sb.from('pantry_items').update({ done, done_buy_id: null }).eq('id', item.id));
  } catch (err) {
    console.error(err);
    item.done = !done;
    renderPantry();
    toast('변경에 실패했어요. 다시 시도해 주세요');
  }
}

// item 이 없으면 새로 담기(여러 줄), 있으면 그 품목 하나를 고친다.
function openPantrySheet(item) {
  state.pantryEditing = item ?? null;
  state.pantryHowId = item?.how_id ?? pantryHows()[0]?.id ?? null;
  el.pDate.value = item?.bought_on ?? todayLocal();
  el.pDel.hidden = !item;
  el.pCharged.hidden = !item?.charged_buy_id;
  renderPantryHows();
  el.pItems.innerHTML = item
    ? pantryEditRowHtml(item)
    : itemRowHtml({ name: '', amount: 0 }, { last: true, placeholder: PANTRY_PLACEHOLDER });
  recalcPantryTotal();
  updatePantrySaveState();
  openSheet(el.pSheet);
  if (!item) setTimeout(() => el.pItems.querySelector('[data-role="name"]')?.focus(), 250);
}

// 이미 가계부로 넘어간 값은 못 고친다 — 그 끼니의 품목 줄이 원본이라 여기서 바꾸면 둘이 어긋난다.
function pantryEditRowHtml(item) {
  return `
    <div class="row">
      <input type="text" data-role="name" placeholder="${PANTRY_PLACEHOLDER}" maxlength="40" autocomplete="off"
             enterkeyhint="done" value="${escapeHtml(item.name)}">
      <input type="text" data-role="price" class="price" inputmode="numeric" placeholder="0" autocomplete="off"
             value="${item.amount ? formatWon(item.amount) : ''}"${item.charged_buy_id ? ' readonly' : ''}>
    </div>`;
}

function renderPantryHows() {
  el.pHows.innerHTML = pantryHows()
    .map(
      (c) => `<button type="button" class="chip ${c.id === state.pantryHowId ? 'selected' : ''}" data-id="${c.id}">${escapeHtml(c.name)}</button>`,
    )
    .join('');
}

function onPantryHowClick(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.pantryHowId = Number(chip.dataset.id);
  renderPantryHows();
  updatePantrySaveState();
}

function readPantryRows() {
  return [...el.pItems.querySelectorAll('.row')].map((row) => ({
    name: row.querySelector('[data-role="name"]').value.trim(),
    amount: parseWon(row.querySelector('[data-role="price"]').value),
  }));
}

function recalcPantryTotal() {
  const total = readPantryRows().reduce((a, l) => a + l.amount, 0);
  el.pTotal.textContent = total ? formatWon(total) : '';
}

function updatePantrySaveState() {
  el.pSave.disabled = !(state.pantryHowId && readPantryRows().some((l) => l.name));
}

function onPantryInput(e) {
  editItemRow(e.target, PANTRY_PLACEHOLDER);
  recalcPantryTotal();
  updatePantrySaveState();
}

function onPantryItemsClick(e) {
  if (!e.target.closest('[data-act="del-item"]')) return;
  e.target.closest('.row').remove();
  recalcPantryTotal();
  updatePantrySaveState();
}

async function savePantry() {
  const rows = readPantryRows().filter((l) => l.name);
  if (!rows.length || !state.pantryHowId) return;
  const item = state.pantryEditing;

  el.pSave.disabled = true;
  try {
    if (item) {
      const patch = { how_id: state.pantryHowId, name: rows[0].name, bought_on: el.pDate.value };
      if (!item.charged_buy_id) patch.amount = rows[0].amount;
      unwrap(await sb.from('pantry_items').update(patch).eq('id', item.id));
    } else {
      unwrap(
        await sb.from('pantry_items').insert(
          rows.map((l) => ({
            how_id: state.pantryHowId,
            name: l.name,
            amount: l.amount,
            bought_on: el.pDate.value,
            created_by: state.userId,
          })),
        ),
      );
    }
    haptic();
    closeSheet(el.pSheet);
    await refresh();
  } catch (err) {
    console.error(err);
    toast(needsSql(err) ? 'SQL 의 31번 섹션을 먼저 실행해 주세요' : '저장에 실패했어요. 다시 시도해 주세요');
  } finally {
    el.pSave.disabled = false;
  }
}

// 목록에서만 뺀다. 이미 가계부에 들어간 돈은 그 끼니의 품목 줄에 있으므로 그대로 남는다.
async function removePantry() {
  const item = state.pantryEditing;
  if (!item) return;
  const msg = item.charged_buy_id
    ? '이 품목은 이미 가계부에 들어갔어요. 목록에서 빼도 가계부 금액은 그대로예요. 뺄까요?'
    : '이 품목을 뺄까요?';
  if (!confirmDialog(msg)) return;
  try {
    unwrap(await sb.from('pantry_items').delete().eq('id', item.id));
    closeSheet(el.pSheet);
    await refresh();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
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
