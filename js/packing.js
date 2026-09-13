// 준비물 체크리스트: 여행마다 그대로 쓰는 공용 목록 한 벌.
// 대분류(의류·세면도구…)로 묶어 두고, 여행 화면에서는 이 목록을 가져와 "챙겼다" 만 체크한다 (trip_packed).
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic } from './ui.js';
import { groupPacking } from './calc.js';

// 아직 아무것도 안 적었을 때 보여 줄 분류. 여기 없는 분류도 직접 만들 수 있다.
const BASE_GROUPS = ['의류', '세면도구', '전자기기', '서류', '기타'];

const state = { items: [], group: '의류', editing: null, pickedGroup: '기타' };

let el = null;
let initialized = false;
let onChange = () => {}; // 목록이 바뀌면 열려 있는 여행 화면도 다시 그리게

export function init({ onChange: changed } = {}) {
  if (changed) onChange = changed;
  if (initialized) return;
  initialized = true;

  el = {
    groups: $('#packing-groups'),
    quick: $('#packing-quick'),
    title: $('#packing-title'),
    list: $('#packing-list'),
    sheet: $('#sheet-packing'),
    form: $('#packing-form'),
    id: $('#packing-id'),
    name: $('#packing-name'),
    itemGroups: $('#packing-item-groups'),
    save: $('#packing-save'),
    del: $('#packing-delete'),
  };

  bindSheetBackdrop(el.sheet);
  renderGroups();

  el.groups.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.add !== undefined) {
      const name = window.prompt('새 대분류 이름 (예: 의류)');
      if (!name || !name.trim()) return;
      state.group = name.trim();
    } else {
      state.group = chip.dataset.group;
    }
    renderGroups();
    el.title.focus();
  });

  el.quick.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = el.title.value.trim();
    if (!title) return;
    el.title.value = '';
    try {
      const order = state.items.reduce((m, i) => Math.max(m, i.sort_order), 0) + 10;
      unwrap(await sb.from('packing_items').insert({ title, group_name: state.group, sort_order: order }));
      haptic();
      await refresh();
    } catch (err) {
      console.error(err);
      el.title.value = title;
      toast(failText(err));
    }
  });

  el.list.addEventListener('click', onListClick);
  el.itemGroups.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.add !== undefined) {
      const name = window.prompt('새 대분류 이름 (예: 의류)');
      if (!name || !name.trim()) return;
      state.pickedGroup = name.trim();
    } else {
      state.pickedGroup = chip.dataset.group;
    }
    renderItemGroups();
  });
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveItem();
  });
  el.del.addEventListener('click', removeItem);
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

function missingTable(err) {
  const m = `${err?.message ?? ''} ${err?.code ?? ''}`;
  return /does not exist|could not find the (table|function)|42P01|PGRST20[25]/i.test(m);
}

// 실패했을 때는 서버가 한 말을 그대로 보여 준다 — 무엇이 잘못됐는지 알아야 고친다.
function failText(err) {
  if (missingTable(err)) return '준비물 표가 아직 없어요. schema.sql 전체를 한 번 실행해 주세요';
  return err?.message ? `저장에 실패했어요: ${err.message}` : '저장에 실패했어요. 다시 시도해 주세요';
}

// 여행 화면이 목록을 그대로 가져다 쓴다.
export function items() {
  return state.items;
}

// 지금 있는 분류 + 기본 분류
export function groups() {
  const used = [...new Set(state.items.map((i) => i.group_name || '기타'))];
  return [...new Set([...BASE_GROUPS, ...used])];
}

export async function refresh() {
  if (!initialized) return;
  try {
    state.items = unwrap(
      await sb.from('packing_items').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true }),
    );
    renderGroups();
    render();
    onChange();
  } catch (err) {
    console.error(err);
    state.items = [];
    el.list.innerHTML = missingTable(err)
      ? `<p class="empty">준비물 표가 아직 없어요.<br>Supabase SQL Editor 에서<br><code>schema.sql</code> 전체를 한 번 실행해 주세요.</p>`
      : `<div class="retry">불러오지 못했어요<br>
          <button type="button" class="btn small" data-retry>다시 시도</button>
        </div>`;
  }
}

function renderGroups() {
  el.groups.innerHTML =
    groups()
      .map((g) => `<button type="button" class="chip ${g === state.group ? 'selected' : ''}" data-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`)
      .join('') + '<button type="button" class="chip add" data-add>＋ 분류</button>';
}

function render() {
  const groups = groupPacking(state.items, BASE_GROUPS);
  el.list.innerHTML = groups.length
    ? groups
        .map(
          (g) => `
        <div class="group-head"><span>${escapeHtml(g.name)}</span><span class="sub">${g.items.length}</span></div>
        ${g.items
          .map(
            (it, i) => `
          <div class="todo-row item-row" data-id="${it.id}" style="--i:${Math.min(i, 12)}">
            <div class="todo-main"><div class="todo-title">${escapeHtml(it.title)}</div></div>
            <button type="button" class="icon-btn" data-act="up" aria-label="위로">▲</button>
            <button type="button" class="icon-btn" data-act="down" aria-label="아래로">▼</button>
          </div>`,
          )
          .join('')}`,
        )
        .join('')
    : '<p class="empty small">아직 없어요<br>위에서 분류를 고르고 챙길 것을 적어 두세요</p>';
}

async function onListClick(e) {
  if (e.target.closest('[data-retry]')) return refresh();
  const row = e.target.closest('[data-id]');
  if (!row) return;
  const item = state.items.find((x) => x.id === Number(row.dataset.id));
  if (!item) return;
  const act = e.target.closest('[data-act]')?.dataset.act;

  if (!act) return openItem(item); // 이름을 누르면 고치는 시트
  try {
    await move(item, act === 'up' ? -1 : 1);
    await refresh();
  } catch (err) {
    console.error(err);
    toast('변경에 실패했어요. 다시 시도해 주세요');
  }
}

// 같은 분류 안에서 위아래로 한 칸. 자리가 바뀐 줄만 고친다.
async function move(item, dir) {
  const same = groupPacking(state.items, BASE_GROUPS).find((g) => g.name === (item.group_name || '기타'))?.items ?? [];
  const at = same.findIndex((x) => x.id === item.id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= same.length) return;
  const a = same[at];
  const b = same[to];
  unwrap(await sb.from('packing_items').update({ sort_order: b.sort_order }).eq('id', a.id));
  unwrap(await sb.from('packing_items').update({ sort_order: a.sort_order }).eq('id', b.id));
}

// ---- 항목 시트 ----------------------------------------------------------------

function openItem(item) {
  state.editing = item;
  state.pickedGroup = item.group_name || '기타';
  el.id.value = item.id;
  el.name.value = item.title;
  renderItemGroups();
  openSheet(el.sheet);
}

function renderItemGroups() {
  el.itemGroups.innerHTML =
    [...new Set([...groups(), state.pickedGroup])]
      .map(
        (g) =>
          `<button type="button" class="chip ${g === state.pickedGroup ? 'selected' : ''}" data-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`,
      )
      .join('') + '<button type="button" class="chip add" data-add>＋ 분류</button>';
}

async function saveItem() {
  const item = state.editing;
  const title = el.name.value.trim();
  if (!item || !title) return;
  el.save.disabled = true;
  try {
    unwrap(await sb.from('packing_items').update({ title, group_name: state.pickedGroup }).eq('id', item.id));
    haptic();
    closeSheet(el.sheet);
    await refresh();
  } catch (err) {
    console.error(err);
    toast(failText(err));
  } finally {
    el.save.disabled = false;
  }
}

async function removeItem() {
  const item = state.editing;
  if (!item) return;
  if (!confirmDialog(`"${item.title}" 을 목록에서 지울까요?\n지난 여행의 체크도 함께 사라져요.`)) return;
  try {
    unwrap(await sb.from('packing_items').delete().eq('id', item.id));
    closeSheet(el.sheet);
    await refresh();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
}
