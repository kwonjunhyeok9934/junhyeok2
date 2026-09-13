// 식비 탭: 한 주(월~일)의 아침·점심·저녁·야식 식단. 금액을 넣으면 가계부에도 함께 기록된다.
// 금액은 이 표에 없다 — 돈을 쓴 끼니는 transactions 행 하나와 1:1 로 연결되고, 조회할 때 m.tx 로 딸려 온다.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic, animateNumber } from './ui.js';
import {
  todayLocal, shiftDay, formatWon, parseWon, dayName,
  MEAL_SLOTS, SLOT_LABEL, weekStart, weekDays, weekLabel, slotOfHour, mealMemo, resolveMealCategoryId,
  mealAmount, groupMealsBySlot, sumMeals, sumMealsByDate, sumMealsByCategory, planMealSave, planMealDelete,
} from './calc.js';
import { fetchCategories, addCategory } from './categories.js';

const state = {
  start: '',          // 보고 있는 주의 월요일
  meals: [],          // 직전 주 + 이번 주 (한 번에 받아 온다)
  cats: [],
  userId: null,
  editing: null,      // 수정 중인 기록, 새 항목이면 null
  selectedCat: null,
  pendingTxId: null,  // 거래는 만들었는데 식단 저장이 실패했을 때. 재시도에서 재사용한다
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
    label: $('#meal-label'),
    prev: $('#meal-prev'),
    next: $('#meal-next'),
    thisWeek: $('#meal-this-week'),
    sum: $('#meal-sum'),
    sumPrev: $('#meal-sum-prev'),
    sumDiff: $('#meal-sum-diff'),
    onboard: $('#meal-onboard'),
    week: $('#meal-week'),
    catTotals: $('#meal-cat-totals'),
    catList: $('#meal-cat-list'),
    sheet: $('#sheet-meal'),
    form: $('#meal-form'),
    id: $('#meal-id'),
    date: $('#meal-date'),
    menu: $('#meal-menu'),
    cats: $('#meal-cats'),
    newCatRow: $('#meal-new-cat-row'),
    newCat: $('#meal-new-cat'),
    newCatOk: $('#meal-new-cat-ok'),
    amountField: $('#meal-amount-field'),
    amount: $('#meal-amount'),
    boughtRow: $('#meal-bought-row'),
    bought: $('#meal-bought'),
    catWarn: $('#meal-cat-warn'),
    save: $('#meal-save'),
    del: $('#meal-delete'),
  };

  bindSheetBackdrop(el.sheet);
  el.prev.addEventListener('click', () => moveWeek(-1));
  el.next.addEventListener('click', () => moveWeek(1));
  el.thisWeek.addEventListener('click', () => {
    state.start = weekStart(todayLocal());
    refresh();
  });

  el.week.addEventListener('click', onWeekClick);

  el.cats.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.add !== undefined) {
      el.newCatRow.hidden = false;
      el.newCat.focus();
      return;
    }
    state.selectedCat = Number(chip.dataset.id);
    renderChips();
    if (!isHomeCat(state.selectedCat) && !parseWon(el.amount.value)) {
      setTimeout(() => el.amount.focus(), 60);
    }
  });

  el.newCatOk.addEventListener('click', createCategoryFromSheet);
  el.newCat.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createCategoryFromSheet();
    }
  });

  el.amount.addEventListener('input', () => {
    const n = parseWon(el.amount.value);
    el.amount.value = n ? formatWon(n) : '';
    updateSaveState();
  });
  el.menu.addEventListener('input', updateSaveState);
  el.bought.addEventListener('input', updateSaveState);

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
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

export async function refresh() {
  const days = weekDays(state.start);
  const from = shiftDay(state.start, -7); // 직전 주까지 한 번에 받아 비교에 쓴다
  const to = days[6];
  try {
    const [cats, meals] = await Promise.all([
      fetchCategories(),
      sb
        .from('meals')
        .select('*, tx:transactions(id, kind, amount, date, category_id, memo)')
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true })
        .then(unwrap),
    ]);
    state.cats = cats;
    state.meals = meals;
    render();
  } catch (err) {
    console.error(err);
    el.week.innerHTML = missingTable(err)
      ? `<p class="empty">식비 표가 아직 없어요.<br>Supabase SQL Editor 에서<br><code>schema.sql</code> 의 21번 섹션을 실행해 주세요.</p>`
      : `<div class="retry">불러오지 못했어요<br>
          <button type="button" class="btn small" data-retry>다시 시도</button>
        </div>`;
  }
}

// 아직 SQL 을 실행하지 않아 meals 표가 없는 상태인지.
function missingTable(err) {
  const m = `${err?.message ?? ''} ${err?.code ?? ''}`;
  return /does not exist|could not find the table|42P01|PGRST205/i.test(m);
}

// ---- 렌더 -----------------------------------------------------------------

function render() {
  const days = weekDays(state.start);
  const prevStart = shiftDay(state.start, -7);
  const week = state.meals.filter((m) => m.date >= state.start && m.date <= days[6]);
  const prev = state.meals.filter((m) => m.date >= prevStart && m.date < state.start);

  el.label.textContent = weekLabel(state.start);
  el.thisWeek.hidden = state.start === weekStart(todayLocal());

  const sum = sumMeals(week);
  const prevSum = sumMeals(prev);
  const diff = sum.total - prevSum.total;
  animateNumber(el.sum, sum.total, formatWon);
  animateNumber(el.sumPrev, prevSum.total, formatWon);
  animateNumber(el.sumDiff, diff, (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatWon(Math.abs(n))}`);
  el.sumDiff.classList.toggle('income', diff < 0); // 덜 썼으면 파랑

  el.onboard.hidden = week.length > 0;

  const byDate = sumMealsByDate(week);
  const grouped = groupMealsBySlot(week);
  const catName = new Map(state.cats.map((c) => [c.id, c.name]));
  const today = todayLocal();
  let i = 0;

  el.week.innerHTML = days
    .map((date) => {
      const total = byDate.get(date) ?? 0;
      const body = MEAL_SLOTS.map((slot) => {
        const items = grouped.get(`${date}|${slot}`) ?? [];
        if (!items.length) return emptyRow(date, slot, i++);
        return items.map((m, k) => mealRow(m, slot, k === 0, k === items.length - 1, catName, i++)).join('');
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

  const byCat = sumMealsByCategory(week, state.cats);
  el.catTotals.hidden = !week.length;
  el.catList.innerHTML = byCat
    .map((c) => `<li><span>${escapeHtml(c.name)}</span><span>${c.total ? formatWon(c.total) : `${c.count}끼`}</span></li>`)
    .join('');
}

function mealRow(m, slot, first, last, catName, i) {
  const amount = mealAmount(m);
  const cat = catName.get(m.category_id) ?? '';
  const title = (m.menu || m.bought || cat || '기록').trim();
  const sub = [cat, m.menu && m.bought ? m.bought : ''].filter(Boolean).join(' · ');
  return `
    <div class="tx-row meal-row" data-id="${m.id}" style="--i:${Math.min(i, 12)}">
      <div class="meal-slot">${first ? SLOT_LABEL[slot] ?? '' : ''}</div>
      <div class="tx-main">
        <div class="tx-cat">${escapeHtml(title)}</div>
        ${sub ? `<div class="tx-memo">${escapeHtml(sub)}</div>` : ''}
      </div>
      <div class="tx-amount">${amount ? formatWon(amount) : ''}</div>
      ${last
        ? `<button type="button" class="icon-btn slot-add" data-date="${m.date}" data-slot="${slot}" aria-label="${SLOT_LABEL[slot]}에 하나 더">＋</button>`
        : '<span class="slot-add" aria-hidden="true"></span>'}
    </div>`;
}

function emptyRow(date, slot, i) {
  return `
    <div class="tx-row meal-row empty-slot" data-date="${date}" data-slot="${slot}" style="--i:${Math.min(i, 12)}">
      <div class="meal-slot">${SLOT_LABEL[slot]}</div>
      <div class="tx-main muted">＋ 기록</div>
      <span class="slot-add" aria-hidden="true"></span>
    </div>`;
}

function onWeekClick(e) {
  if (e.target.closest('[data-retry]')) {
    refresh();
    return;
  }
  const add = e.target.closest('.slot-add');
  if (add?.dataset.date) {
    openMealSheet(null, { date: add.dataset.date, slot: add.dataset.slot });
    return;
  }
  const empty = e.target.closest('.empty-slot');
  if (empty) {
    openMealSheet(null, { date: empty.dataset.date, slot: empty.dataset.slot });
    return;
  }
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
  state.pendingTxId = null;

  el.id.value = m?.id ?? '';
  el.date.value = m?.date ?? preset.date ?? todayLocal();
  const slot = m?.slot ?? preset.slot ?? 'lunch';
  const radio = el.form.querySelector(`input[name="meal-slot"][value="${slot}"]`);
  if (radio) radio.checked = true;

  el.menu.value = m?.menu ?? '';
  el.bought.value = m?.bought ?? '';
  const amount = m ? mealAmount(m) : 0;
  el.amount.value = amount ? formatWon(amount) : '';

  state.selectedCat = m?.category_id ?? defaultMealCat();
  el.del.hidden = !m;
  el.newCatRow.hidden = true;
  el.newCat.value = '';
  renderChips(); // 안에서 금액·산 것 표시 여부와 저장 버튼 상태까지 맞춘다

  openSheet(el.sheet);
  if (!m) setTimeout(() => el.menu.focus(), 250);
}

// '집밥' 은 돈을 안 쓴 끼니라는 뜻이라 금액·산 것 칸을 숨긴다.
// 사용자가 이름을 바꾸면 평범한 카테고리가 되고 금액 칸이 늘 보인다 (기능은 안 깨진다).
function isHomeCat(id) {
  return state.cats.some((c) => c.id === id && c.kind === 'meal' && c.name === '집밥');
}

function defaultMealCat() {
  const meal = state.cats.filter((c) => c.kind === 'meal');
  return (meal.find((c) => c.name === '집밥') ?? meal[0])?.id ?? null;
}

function renderChips() {
  const chips = state.cats
    .filter((c) => c.kind === 'meal')
    .map(
      (c) =>
        `<button type="button" class="chip ${c.id === state.selectedCat ? 'selected' : ''}" data-id="${c.id}">${escapeHtml(c.name)}</button>`,
    );
  chips.push('<button type="button" class="chip add" data-add>＋ 새 카테고리</button>');
  el.cats.innerHTML = chips.join('');
  syncMoneyFields();
}

function syncMoneyFields() {
  const home = isHomeCat(state.selectedCat);
  el.amountField.hidden = home;
  el.boughtRow.hidden = home;
  if (home) el.amount.value = '';
  el.catWarn.hidden = home || state.cats.some((c) => c.kind === 'expense' && c.name === '식비');
  updateSaveState();
}

function updateSaveState() {
  const filled = el.menu.value.trim() || (!el.boughtRow.hidden && el.bought.value.trim()) || readAmount() > 0;
  el.save.disabled = !filled;
}

function readAmount() {
  return el.amountField.hidden ? 0 : parseWon(el.amount.value);
}

function readSheet() {
  return {
    date: el.date.value,
    slot: el.form.querySelector('input[name="meal-slot"]:checked')?.value ?? 'lunch',
    menu: el.menu.value,
    bought: el.boughtRow.hidden ? '' : el.bought.value,
    categoryId: state.selectedCat,
    amount: readAmount(),
  };
}

async function createCategoryFromSheet() {
  const name = el.newCat.value;
  if (!name.trim()) return;
  try {
    const created = await addCategory(name, 'meal', state.cats);
    state.cats = await fetchCategories();
    state.selectedCat = created.id;
    el.newCat.value = '';
    el.newCatRow.hidden = true;
    renderChips();
  } catch (err) {
    console.error(err);
    toast('카테고리를 추가하지 못했어요');
  }
}

// ---- 저장·삭제 ------------------------------------------------------------
// 순서는 언제나 "가계부 먼저, 식단 나중". 중간에 실패해도 금액이 조용히 사라지지 않고,
// 가계부에 눈에 보이는 행이 남아 사용자가 직접 지울 수 있다.

async function save() {
  const input = readSheet();
  if (!input.menu.trim() && !input.bought.trim() && input.amount <= 0) return;

  const before = state.editing;
  if (
    before?.transaction_id &&
    input.amount <= 0 &&
    !confirmDialog('금액을 지우면 가계부의 이 지출도 함께 사라져요. 계속할까요?')
  ) return;

  const catName = state.cats.find((c) => c.id === input.categoryId)?.name ?? '';
  const memo = mealMemo({ slot: input.slot, menu: input.menu, bought: input.bought, cat: catName });
  const plan = planMealSave(before, input, {
    categoryId: resolveMealCategoryId(state.cats, before?.tx ?? null),
    memo,
  });

  el.save.disabled = true;
  let txId = state.pendingTxId;   // 직전 시도에서 이미 만든 거래가 있으면 재사용한다
  let created = txId != null;     // 이번 저장 흐름에서 우리가 만든 거래인가
  try {
    // 1단계: 가계부
    if (plan.tx.op === 'insert') {
      if (txId == null) {
        txId = await insertTx(plan.tx.payload);
        created = true;
      } else {
        unwrap(await sb.from('transactions').update(plan.tx.payload).eq('id', txId).select('id'));
      }
    } else if (plan.tx.op === 'update') {
      // update 는 0행을 고쳐도 에러가 아니다. 가계부에서 이미 지워졌으면 새로 만들고 다시 연결한다.
      const rows = unwrap(await sb.from('transactions').update(plan.tx.payload).eq('id', plan.tx.id).select('id'));
      if (!rows.length) {
        txId = await insertTx(plan.tx.payload);
        created = true;
        plan.meal.link = 'new';
      }
    } else if (plan.tx.op === 'delete') {
      unwrap(await sb.from('transactions').delete().eq('id', plan.tx.id));
    }

    // 2단계: 식단
    const link =
      plan.meal.link === 'new' ? { transaction_id: txId }
      : plan.meal.link === 'null' ? { transaction_id: null }
      : {};
    const row = { ...plan.meal.patch, ...link };
    if (plan.meal.op === 'insert') unwrap(await sb.from('meals').insert({ ...row, created_by: state.userId }));
    else unwrap(await sb.from('meals').update(row).eq('id', plan.meal.id));

    state.pendingTxId = null;
    haptic();
    closeSheet(el.sheet);
    state.start = weekStart(input.date); // 저장한 날이 든 주로 옮긴다
    await refresh();
    if (plan.tx.op !== 'none') onTxChange();
  } catch (err) {
    console.error(err);
    // 이번 저장에서 새로 만든 거래만 되돌린다. 남의 거래를 지우지 않는다.
    if (created && txId != null) {
      const { error } = await sb.from('transactions').delete().eq('id', txId);
      state.pendingTxId = error ? txId : null;
    }
    toast(
      state.pendingTxId
        ? '가계부에는 기록됐지만 식단 저장에 실패했어요. 다시 저장해 주세요'
        : '저장에 실패했어요. 다시 시도해 주세요',
    );
  } finally {
    el.save.disabled = false;
  }
}

async function insertTx(payload) {
  const row = unwrap(
    await sb.from('transactions').insert({ ...payload, created_by: state.userId }).select('id').single(),
  );
  state.pendingTxId = row.id;
  return row.id;
}

async function remove() {
  if (!state.editing) return;
  const plan = planMealDelete(state.editing);
  const amount = mealAmount(state.editing);
  const msg = amount
    ? `이 기록을 지우면 가계부의 ${formatWon(amount)}원 지출도 함께 사라져요. 지울까요?`
    : '이 기록을 지울까요?';
  if (!confirmDialog(msg)) return;
  try {
    if (plan.tx.op === 'delete') unwrap(await sb.from('transactions').delete().eq('id', plan.tx.id));
    unwrap(await sb.from('meals').delete().eq('id', plan.meal.id));
    closeSheet(el.sheet);
    await refresh();
    if (plan.tx.op !== 'none') onTxChange();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
}
