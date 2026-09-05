// 고정비 탭: 월 고정비 항목 목록과 합계. 날짜 없이 계속 유지된다.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic, animateNumber } from './ui.js';
import { formatWon, parseWon } from './calc.js';
import { fetchCategories, addCategory } from './categories.js';

const state = { items: [], profiles: [], cats: [], editing: null };
let el = null;
let initialized = false;

export function init() {
  if (initialized) return;
  initialized = true;
  el = {
    sum: $('#fixed-sum'),
    byOwner: $('#fixed-by-owner'),
    presets: $('#fixed-presets'),
    newCatRow: $('#fixed-new-cat-row'),
    newCat: $('#fixed-new-cat'),
    newCatOk: $('#fixed-new-cat-ok'),
    owner: $('#fixed-owner'),
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

  el.presets.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.add !== undefined) {
      el.newCatRow.hidden = false;
      el.newCat.focus();
      return;
    }
    el.name.value = chip.dataset.name;
    markPreset();
    el.name.dispatchEvent(new Event('input'));
    el.amount.focus();
  });
  el.name.addEventListener('input', markPreset);
  el.newCatOk.addEventListener('click', createCategory);
  el.newCat.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createCategory();
    }
  });

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

function renderChips() {
  const chips = state.cats.filter((c) => c.kind === 'fixed').map((c) => `<button type="button" class="chip" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>`);
  chips.push('<button type="button" class="chip add" data-add>＋ 새 카테고리</button>');
  el.presets.innerHTML = chips.join('');
  markPreset();
}

function markPreset() {
  el.presets.querySelectorAll('.chip[data-name]').forEach((c) => c.classList.toggle('selected', c.dataset.name === el.name.value.trim()));
}

async function createCategory() {
  const name = el.newCat.value.trim();
  if (!name) return;
  try {
    await addCategory(name, 'fixed', state.cats);
    state.cats = await fetchCategories();
    el.newCat.value = '';
    el.newCatRow.hidden = true;
    el.name.value = name;
    renderChips();
    el.name.dispatchEvent(new Event('input'));
    el.amount.focus();
  } catch (err) {
    console.error(err);
    toast('카테고리를 추가하지 못했어요');
  }
}

export async function refresh() {
  try {
    const [profiles, cats, items] = await Promise.all([
      sb.from('profiles').select('id,name,color').then(unwrap),
      fetchCategories(),
      sb.from('fixed_costs').select('*').order('created_at', { ascending: true }).then(unwrap),
    ]);
    state.profiles = profiles;
    state.cats = cats;
    state.items = items;
    render();
  } catch (err) {
    console.error(err);
    el.list.innerHTML = `
      <div class="retry">불러오지 못했어요<br>
        <button type="button" class="btn small" data-retry>다시 시도</button>
      </div>`;
  }
}

// 주인 목록: 공통(null) 먼저, 그 다음 profiles 순서.
function owners() {
  return [{ id: null, name: '공통' }, ...state.profiles];
}

function render() {
  const total = state.items.reduce((a, x) => a + x.amount, 0);
  animateNumber(el.sum, total, formatWon);

  const groups = owners().map((o) => ({
    ...o,
    items: state.items.filter((x) => (x.owner ?? null) === o.id),
  }));
  for (const g of groups) g.total = g.items.reduce((a, x) => a + x.amount, 0);

  el.byOwner.innerHTML = groups
    .map((g) => `<li><span class="who">${escapeHtml(g.name)}</span><span class="amt">${formatWon(g.total)}</span></li>`)
    .join('');

  if (!state.items.length) {
    el.list.innerHTML = '<p class="empty">고정비를 아직 안 적었어요<br>오른쪽 아래 + 로 추가해 보세요</p>';
    return;
  }
  let i = 0;
  el.list.innerHTML = groups
    .filter((g) => g.items.length)
    .map(
      (g) => `
      <div class="group-head"><span>${escapeHtml(g.name)}</span><span class="sub">${formatWon(g.total)}</span></div>
      ${g.items
        .map(
          (x) => `
      <div class="tx-row" data-id="${x.id}" style="--i:${Math.min(i++, 12)}">
        <div class="tx-main">
          <div class="tx-cat">${escapeHtml(x.name)}</div>
          ${x.memo ? `<div class="tx-memo">${escapeHtml(x.memo)}</div>` : ''}
        </div>
        <div class="tx-amount">${formatWon(x.amount)}</div>
      </div>`,
        )
        .join('')}`,
    )
    .join('');
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
  el.newCatRow.hidden = true;
  el.newCat.value = '';
  renderChips();
  el.owner.innerHTML = owners()
    .map(
      (o) => `<label><input type="radio" name="fixed-owner" value="${o.id ?? ''}" ${String(item?.owner ?? '') === String(o.id ?? '') ? 'checked' : ''}><span>${escapeHtml(o.name)}</span></label>`,
    )
    .join('');
  el.save.disabled = !item;
  el.del.hidden = !item;
  openSheet(el.sheet);
  if (!item) setTimeout(() => el.name.focus(), 250);
}

async function save() {
  const payload = {
    name: el.name.value.trim(),
    amount: parseWon(el.amount.value),
    memo: el.memo.value.trim(),
    owner: el.form.querySelector('input[name="fixed-owner"]:checked')?.value || null,
  };
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
