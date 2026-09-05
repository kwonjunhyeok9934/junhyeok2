// 고정비 탭: 월 고정비 항목 목록과 합계. 날짜 없이 계속 유지된다.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic, animateNumber } from './ui.js';
import { formatWon, parseWon } from './calc.js';

const state = { items: [], editing: null };
let el = null;
let initialized = false;

export function init() {
  if (initialized) return;
  initialized = true;
  el = {
    sum: $('#fixed-sum'),
    count: $('#fixed-count'),
    list: $('#fixed-list'),
    sheet: $('#sheet-fixed'),
    form: $('#fixed-form'),
    id: $('#fixed-id'),
    name: $('#fixed-name'),
    amount: $('#fixed-amount'),
    memo: $('#fixed-memo'),
    save: $('#fixed-save'),
    del: $('#fixed-delete'),
  };
  bindSheetBackdrop(el.sheet);

  el.list.addEventListener('click', (e) => {
    const row = e.target.closest('.tx-row');
    if (row) openFixedSheet(state.items.find((x) => x.id === Number(row.dataset.id)));
    if (e.target.closest('[data-retry]')) refresh();
  });
  const validate = () => {
    el.save.disabled = !el.name.value.trim() || parseWon(el.amount.value) <= 0;
  };
  el.name.addEventListener('input', validate);
  el.amount.addEventListener('input', () => {
    const n = parseWon(el.amount.value);
    el.amount.value = n ? formatWon(n) : '';
    validate();
  });
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

export async function refresh() {
  try {
    state.items = unwrap(await sb.from('fixed_costs').select('*').order('created_at', { ascending: true }));
    render();
  } catch (err) {
    console.error(err);
    el.list.innerHTML = `
      <div class="retry">불러오지 못했어요<br>
        <button type="button" class="btn small" data-retry>다시 시도</button>
      </div>`;
  }
}

function render() {
  const total = state.items.reduce((a, x) => a + x.amount, 0);
  animateNumber(el.sum, total, formatWon);
  el.count.textContent = state.items.length ? `${state.items.length}개 항목` : '';
  el.list.innerHTML = state.items.length
    ? state.items
        .map(
          (x, i) => `
      <div class="tx-row" data-id="${x.id}" style="--i:${Math.min(i, 12)}">
        <div class="tx-main">
          <div class="tx-cat">${escapeHtml(x.name)}</div>
          ${x.memo ? `<div class="tx-memo">${escapeHtml(x.memo)}</div>` : ''}
        </div>
        <div class="tx-amount">${formatWon(x.amount)}</div>
      </div>`,
        )
        .join('')
    : '<p class="empty">고정비를 아직 안 적었어요<br>오른쪽 아래 + 로 추가해 보세요</p>';
}

export function openNew() {
  openFixedSheet(null);
}

function openFixedSheet(item) {
  state.editing = item ?? null;
  el.id.value = item?.id ?? '';
  el.name.value = item?.name ?? '';
  el.amount.value = item ? formatWon(item.amount) : '';
  el.memo.value = item?.memo ?? '';
  el.save.disabled = !item;
  el.del.hidden = !item;
  openSheet(el.sheet);
  if (!item) setTimeout(() => el.name.focus(), 250);
}

async function save() {
  const payload = { name: el.name.value.trim(), amount: parseWon(el.amount.value), memo: el.memo.value.trim() };
  if (!payload.name || payload.amount <= 0) return;
  el.save.disabled = true;
  try {
    if (state.editing) unwrap(await sb.from('fixed_costs').update(payload).eq('id', state.editing.id));
    else unwrap(await sb.from('fixed_costs').insert(payload));
    haptic();
    closeSheet(el.sheet);
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
  if (!confirmDialog(`"${state.editing.name}" 항목을 삭제할까요?`)) return;
  try {
    unwrap(await sb.from('fixed_costs').delete().eq('id', state.editing.id));
    closeSheet(el.sheet);
    await refresh();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
}
