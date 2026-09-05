// 가계부 탭: 월 이동, 조회, 요약·목록 렌더, 입력 시트 저장/삭제.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog } from './ui.js';
import {
  monthRange, shiftMonth, monthLabel, todayLocal, summarize, sumByCategory, groupByDate, formatWon, parseWon,
} from './calc.js';
import { fetchCategories, addCategory } from './categories.js';

const state = {
  year: 0,
  month: 0,
  txs: [],
  cats: [],
  profiles: [],
  userId: null,
  editing: null,      // 수정 중인 거래 행, 새 항목이면 null
  kind: 'expense',
  selectedCat: null,
};

let el = null;
let initialized = false;

export function init({ userId }) {
  state.userId = userId;
  if (initialized) return;
  initialized = true;

  const today = todayLocal();
  state.year = Number(today.slice(0, 4));
  state.month = Number(today.slice(5, 7));

  el = {
    label: $('#month-label'),
    sumIncome: $('#sum-income'),
    sumExpense: $('#sum-expense'),
    sumBalance: $('#sum-balance'),
    catTotals: $('#cat-totals-list'),
    list: $('#tx-list'),
    sheet: $('#sheet-tx'),
    form: $('#tx-form'),
    id: $('#tx-id'),
    amount: $('#tx-amount'),
    cats: $('#tx-cats'),
    newCatRow: $('#tx-new-cat-row'),
    newCat: $('#tx-new-cat'),
    newCatOk: $('#tx-new-cat-ok'),
    date: $('#tx-date'),
    memo: $('#tx-memo'),
    save: $('#tx-save'),
    del: $('#tx-delete'),
  };

  $('#month-prev').addEventListener('click', () => moveMonth(-1));
  $('#month-next').addEventListener('click', () => moveMonth(1));
  bindSheetBackdrop(el.sheet);

  el.form.querySelectorAll('input[name="kind"]').forEach((r) =>
    r.addEventListener('change', () => {
      state.kind = r.value;
      state.selectedCat = null;
      renderChips();
    }),
  );

  el.amount.addEventListener('input', () => {
    const n = parseWon(el.amount.value);
    el.amount.value = n ? formatWon(n) : '';
    el.save.disabled = n <= 0;
  });

  el.cats.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.add !== undefined) {
      el.newCatRow.hidden = false;
      el.newCat.focus();
      return;
    }
    const id = Number(chip.dataset.id);
    state.selectedCat = state.selectedCat === id ? null : id;
    renderChips();
  });

  el.newCatOk.addEventListener('click', createCategoryFromSheet);
  el.newCat.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createCategoryFromSheet();
    }
  });

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  el.del.addEventListener('click', remove);

  el.list.addEventListener('click', (e) => {
    const row = e.target.closest('.tx-row');
    if (row) openTxSheet(state.txs.find((t) => t.id === Number(row.dataset.id)));
    const retry = e.target.closest('[data-retry]');
    if (retry) refresh();
  });
}

function moveMonth(delta) {
  const { year, month } = shiftMonth(state.year, state.month, delta);
  state.year = year;
  state.month = month;
  refresh();
}

export async function refresh() {
  const { start, end } = monthRange(state.year, state.month);
  el.label.textContent = monthLabel(state.year, state.month);
  try {
    const [cats, profiles, txs] = await Promise.all([
      fetchCategories(),
      sb.from('profiles').select('id,name,color').then(unwrap),
      sb
        .from('transactions')
        .select('*')
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .then(unwrap),
    ]);
    state.cats = cats;
    state.profiles = profiles;
    state.txs = txs;
    render();
  } catch (err) {
    console.error(err);
    el.list.innerHTML = `
      <div class="retry">불러오지 못했어요<br>
        <button type="button" class="btn small" data-retry>다시 시도</button>
      </div>`;
  }
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

function render() {
  const sum = summarize(state.txs);
  el.sumIncome.textContent = formatWon(sum.income);
  el.sumExpense.textContent = formatWon(sum.expense);
  el.sumBalance.textContent = formatWon(sum.balance);

  const byCat = sumByCategory(state.txs, state.cats);
  el.catTotals.innerHTML = byCat.length
    ? byCat.map((c) => `<li><span>${escapeHtml(c.name)}</span><span>${formatWon(c.total)}</span></li>`).join('')
    : '<li class="hint">지출이 없어요</li>';

  if (!state.txs.length) {
    el.list.innerHTML = '<p class="empty">이번 달 기록이 없어요</p>';
    return;
  }
  const catName = new Map(state.cats.map((c) => [c.id, c.name]));
  const profile = new Map(state.profiles.map((p) => [p.id, p]));
  el.list.innerHTML = groupByDate(state.txs)
    .map(
      (g) => `
      <div class="date-head">${dateHead(g.date)}</div>
      ${g.items.map((t) => txRow(t, catName, profile)).join('')}`,
    )
    .join('');
}

function dateHead(date) {
  const [y, m, d] = date.split('-').map(Number);
  const day = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일 (${day})`;
}

function txRow(t, catName, profile) {
  const p = profile.get(t.created_by);
  const initial = p ? p.name.slice(0, 1) : '?';
  const color = p ? p.color : '#9ca3af';
  const isIncome = t.kind === 'income';
  return `
    <div class="tx-row" data-id="${t.id}">
      <div class="tx-main">
        <div class="tx-cat">${escapeHtml(catName.get(t.category_id) ?? '미분류')}</div>
        ${t.memo ? `<div class="tx-memo">${escapeHtml(t.memo)}</div>` : ''}
      </div>
      <div class="tx-amount ${isIncome ? 'income' : ''}">${isIncome ? '+' : ''}${formatWon(t.amount)}</div>
      <div class="avatar" style="background:${escapeHtml(color)}" title="${escapeHtml(p?.name ?? '')}">${escapeHtml(initial)}</div>
    </div>`;
}

// ---- 입력 시트 ------------------------------------------------------------

export function openNew() {
  openTxSheet(null);
}

function openTxSheet(tx) {
  state.editing = tx ?? null;
  state.kind = tx?.kind ?? 'expense';
  state.selectedCat = tx?.category_id ?? null;

  el.id.value = tx?.id ?? '';
  el.form.querySelector(`input[name="kind"][value="${state.kind}"]`).checked = true;
  el.amount.value = tx ? formatWon(tx.amount) : '';
  el.date.value = tx?.date ?? todayLocal();
  el.memo.value = tx?.memo ?? '';
  el.save.disabled = !tx;
  el.del.hidden = !tx;
  el.newCatRow.hidden = true;
  el.newCat.value = '';
  renderChips();
  openSheet(el.sheet);
  if (!tx) setTimeout(() => el.amount.focus(), 250);
}

function renderChips() {
  const chips = state.cats
    .filter((c) => c.kind === state.kind)
    .map(
      (c) =>
        `<button type="button" class="chip ${c.id === state.selectedCat ? 'selected' : ''}" data-id="${c.id}">${escapeHtml(c.name)}</button>`,
    );
  chips.push('<button type="button" class="chip add" data-add>＋ 새 카테고리</button>');
  el.cats.innerHTML = chips.join('');
}

async function createCategoryFromSheet() {
  const name = el.newCat.value;
  if (!name.trim()) return;
  try {
    const created = await addCategory(name, state.kind, state.cats);
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

async function save() {
  const amount = parseWon(el.amount.value);
  if (amount <= 0) return;
  const payload = {
    kind: state.kind,
    amount,
    category_id: state.selectedCat,
    date: el.date.value,
    memo: el.memo.value.trim(),
  };
  el.save.disabled = true;
  try {
    if (state.editing) {
      unwrap(await sb.from('transactions').update(payload).eq('id', state.editing.id));
    } else {
      unwrap(await sb.from('transactions').insert({ ...payload, created_by: state.userId }));
    }
    closeSheet(el.sheet);
    jumpToMonthOf(payload.date);
    await refresh();
  } catch (err) {
    console.error(err);
    toast('저장에 실패했어요. 다시 시도해 주세요');
  } finally {
    el.save.disabled = false;
  }
}

async function remove() {
  if (!state.editing) return;
  if (!confirmDialog('이 기록을 삭제할까요?')) return;
  try {
    unwrap(await sb.from('transactions').delete().eq('id', state.editing.id));
    closeSheet(el.sheet);
    await refresh();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
}

// 저장한 날짜가 보고 있는 달과 다르면 그 달로 이동한다.
function jumpToMonthOf(date) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (y && m) {
    state.year = y;
    state.month = m;
  }
}
