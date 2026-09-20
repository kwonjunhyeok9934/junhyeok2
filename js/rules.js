// 규칙 탭: 둘이 정해 둔 집안 규칙을 대분류별로 적어 두고, 안 지킨 횟수를 센다.
// 돈과는 아무 상관이 없다 — 가계부를 건드리지 않는다.
//
// 목록에서 규칙 줄을 누르면 고치는 시트가 열리고, 오른쪽 '＋1' 을 누르면 그 자리에서
// 한 번 셈한다. 세는 쪽이 훨씬 자주 하는 일이라 한 번에 누를 수 있게 떼어 두었다.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic } from './ui.js';
import { fetchCategories, addCategory } from './categories.js';

const state = {
  rules: [],
  cats: [],
  userId: null,
  editing: null,   // 고치는 중인 규칙, 새 규칙이면 null
  catId: null,
  miss: 0,
};

let el = null;
let initialized = false;

export function init({ userId }) {
  state.userId = userId;
  if (initialized) return;
  initialized = true;

  el = {
    list: $('#rule-list'), onboard: $('#rule-onboard'),
    sheet: $('#sheet-rule'), form: $('#rule-form'), id: $('#rule-id'), text: $('#rule-text'),
    cats: $('#rule-cats'), newCatRow: $('#rule-new-cat-row'),
    newCat: $('#rule-new-cat'), newCatOk: $('#rule-new-cat-ok'),
    missRow: $('#rule-miss-row'), missCount: $('#rule-miss-count'),
    missUp: $('#rule-miss-up'), missDown: $('#rule-miss-down'), missReset: $('#rule-miss-reset'),
    save: $('#rule-save'), del: $('#rule-delete'),
  };

  bindSheetBackdrop(el.sheet);
  el.list.addEventListener('click', onListClick);
  el.cats.addEventListener('click', onCatClick);
  el.newCatOk.addEventListener('click', createCat);
  el.newCat.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); createCat(); }
  });

  el.missUp.addEventListener('click', () => setMiss(state.miss + 1));
  el.missDown.addEventListener('click', () => setMiss(state.miss - 1));
  el.missReset.addEventListener('click', () => setMiss(0));

  el.text.addEventListener('input', updateSaveState);
  el.form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  el.del.addEventListener('click', remove);
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

const sheetOpen = () => el.sheet.classList.contains('open');
const catsOf = () => state.cats.filter((c) => c.kind === 'rule');

export async function refresh() {
  if (!initialized || sheetOpen()) return; // 적는 중에는 다시 그리지 않는다
  try {
    const [cats, rules] = await Promise.all([
      fetchCategories(),
      sb.from('rules').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true }).then(unwrap),
    ]);
    state.cats = cats;
    state.rules = rules;
    render();
  } catch (err) {
    console.error(err);
    el.onboard.hidden = true;
    el.list.innerHTML = needsSql(err)
      ? `<p class="empty">규칙 표가 아직 준비되지 않았어요.<br>Supabase SQL Editor 에서<br><code>schema.sql</code> 전체를 한 번 실행해 주세요.</p>`
      : `<div class="retry">불러오지 못했어요<br>
          <button type="button" class="btn small" data-retry>다시 시도</button>
        </div>`;
  }
}

// 아직 SQL 을 실행하지 않은 상태인지 (식비·사 둔 것과 같은 판단).
function needsSql(err) {
  const m = `${err?.message ?? ''} ${err?.code ?? ''}`;
  return /does not exist|could not find the table|42P01|PGRST205/i.test(m);
}

// ---- 목록 -------------------------------------------------------------------

function render() {
  el.onboard.hidden = state.rules.length > 0;

  // 분류 순서대로 묶고, 분류가 지워진 규칙은 맨 밑에 '기타' 로 모은다.
  const groups = catsOf()
    .map((c) => ({ id: c.id, name: c.name, rules: state.rules.filter((r) => r.cat_id === c.id) }))
    .filter((g) => g.rules.length);
  const orphan = state.rules.filter((r) => !catsOf().some((c) => c.id === r.cat_id));
  if (orphan.length) groups.push({ id: null, name: '기타', rules: orphan });

  if (!groups.length) {
    el.list.innerHTML = '<p class="empty small">아직 적어 둔 규칙이 없어요</p>';
    return;
  }

  el.list.innerHTML = groups.map(groupHtml).join('');
}

function groupHtml(g) {
  const misses = g.rules.reduce((a, r) => a + (Number(r.miss_count) || 0), 0);
  return `
    <div class="card day-card">
      <div class="day-head">
        <span>${escapeHtml(g.name)}</span>
        <span class="sub">${misses ? `${misses}회` : ''}</span>
      </div>
      ${g.rules.map(ruleHtml).join('')}
    </div>`;
}

function ruleHtml(r) {
  const n = Number(r.miss_count) || 0;
  return `
    <div class="tx-row rule-row" data-id="${r.id}">
      <div class="rule-text">${escapeHtml(r.text)}</div>
      ${n ? `<span class="rule-count">${n}회</span>` : ''}
      <button type="button" class="chip mini" data-act="miss" aria-label="안 지킨 횟수 세기">＋1</button>
    </div>`;
}

function onListClick(e) {
  if (e.target.closest('[data-retry]')) { refresh(); return; }
  const row = e.target.closest('.rule-row');
  if (!row) return;
  const rule = state.rules.find((r) => r.id === Number(row.dataset.id));
  if (!rule) return;
  if (e.target.closest('[data-act="miss"]')) countMiss(rule);
  else openRuleSheet(rule);
}

// 그 자리에서 한 번 셈한다. 잘못 눌렀으면 규칙을 눌러 시트에서 되돌린다.
async function countMiss(rule) {
  haptic(15);
  try {
    unwrap(
      await sb.from('rules')
        .update({ miss_count: (Number(rule.miss_count) || 0) + 1, missed_at: new Date().toISOString() })
        .eq('id', rule.id),
    );
    await refresh();
  } catch (err) {
    console.error(err);
    toast('세지 못했어요. 다시 시도해 주세요');
  }
}

// ---- 시트 -------------------------------------------------------------------

export function openNew() {
  openRuleSheet(null);
}

function openRuleSheet(rule) {
  state.editing = rule;
  el.id.value = rule?.id ?? '';
  el.text.value = rule?.text ?? '';
  state.catId = rule?.cat_id ?? catsOf()[0]?.id ?? null;
  state.miss = Math.max(0, Number(rule?.miss_count) || 0);

  el.del.hidden = !rule;
  el.missRow.hidden = !rule;          // 새 규칙은 아직 셀 것이 없다
  el.newCatRow.hidden = true;
  el.newCat.value = '';
  renderCats();
  renderMiss();
  updateSaveState();

  openSheet(el.sheet);
  if (!rule) setTimeout(() => el.text.focus(), 250);
}

function renderCats() {
  el.cats.innerHTML = catsOf()
    .map((c) => `<button type="button" class="chip ${c.id === state.catId ? 'selected' : ''}" data-id="${c.id}">${escapeHtml(c.name)}</button>`)
    .join('') + '<button type="button" class="chip add" data-add>＋</button>';
}

function onCatClick(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  if (chip.dataset.add !== undefined) {
    el.newCatRow.hidden = false;
    el.newCat.focus();
    return;
  }
  state.catId = Number(chip.dataset.id);
  renderCats();
  updateSaveState();
}

async function createCat() {
  const name = el.newCat.value;
  if (!name.trim()) return;
  try {
    const created = await addCategory(name, 'rule', state.cats);
    state.cats = await fetchCategories();
    state.catId = created.id;
    el.newCat.value = '';
    el.newCatRow.hidden = true;
    renderCats();
    updateSaveState();
  } catch (err) {
    console.error(err);
    toast('분류를 추가하지 못했어요');
  }
}

function setMiss(n) {
  state.miss = Math.max(0, Math.trunc(n) || 0);
  renderMiss();
}

function renderMiss() {
  el.missCount.textContent = `${state.miss}회`;
  el.missDown.disabled = state.miss <= 0;
}

function updateSaveState() {
  el.save.disabled = !(el.text.value.trim() && state.catId);
}

async function save() {
  const text = el.text.value.trim();
  if (!text || !state.catId) return;
  el.save.disabled = true;
  try {
    if (state.editing) {
      unwrap(
        await sb.from('rules')
          .update({ text, cat_id: state.catId, miss_count: state.miss })
          .eq('id', state.editing.id),
      );
    } else {
      // 새 규칙은 그 분류의 맨 뒤에 붙인다.
      const last = state.rules
        .filter((r) => r.cat_id === state.catId)
        .reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0);
      unwrap(
        await sb.from('rules').insert({
          text, cat_id: state.catId, sort_order: last + 10, created_by: state.userId,
        }),
      );
    }
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
  if (!confirmDialog('이 규칙을 지울까요?')) return;
  try {
    unwrap(await sb.from('rules').delete().eq('id', state.editing.id));
    closeSheet(el.sheet);
    await refresh();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
}
