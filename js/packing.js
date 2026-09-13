// 준비물 체크리스트: 여행마다 그대로 쓰는 공용 목록 한 벌.
// 여행 화면에서는 이 목록을 가져와 "챙겼다" 만 체크한다 (trip_packed).
import { sb } from './supabase.js';
import { $, escapeHtml, toast, confirmDialog, haptic } from './ui.js';

const state = { items: [] };

let el = null;
let initialized = false;
let onChange = () => {}; // 목록이 바뀌면 열려 있는 여행 화면도 다시 그리게

export function init({ onChange: changed } = {}) {
  if (changed) onChange = changed;
  if (initialized) return;
  initialized = true;

  el = { quick: $('#packing-quick'), title: $('#packing-title'), list: $('#packing-list') };

  el.quick.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = el.title.value.trim();
    if (!title) return;
    el.title.value = '';
    try {
      const order = state.items.reduce((m, i) => Math.max(m, i.sort_order), 0) + 10;
      unwrap(await sb.from('packing_items').insert({ title, sort_order: order }));
      haptic();
      await refresh();
    } catch (err) {
      console.error(err);
      el.title.value = title;
      toast(missingTable(err) ? '준비물 표가 아직 없어요. schema.sql 31번을 실행해 주세요' : '저장에 실패했어요. 다시 시도해 주세요');
    }
  });

  el.list.addEventListener('click', onListClick);
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

function missingTable(err) {
  const m = `${err?.message ?? ''} ${err?.code ?? ''}`;
  return /does not exist|could not find the table|42P01|PGRST205/i.test(m);
}

// 여행 화면이 목록을 그대로 가져다 쓴다.
export function items() {
  return state.items;
}

export async function refresh() {
  if (!initialized) return;
  try {
    state.items = unwrap(
      await sb.from('packing_items').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true }),
    );
    render();
    onChange();
  } catch (err) {
    console.error(err);
    state.items = [];
    el.list.innerHTML = missingTable(err)
      ? `<p class="empty">준비물 표가 아직 없어요.<br>Supabase SQL Editor 에서<br><code>schema.sql</code> 의 31번 섹션을 실행해 주세요.</p>`
      : `<div class="retry">불러오지 못했어요<br>
          <button type="button" class="btn small" data-retry>다시 시도</button>
        </div>`;
  }
}

function render() {
  el.list.innerHTML = state.items.length
    ? state.items
        .map(
          (it, i) => `
        <div class="todo-row item-row" data-id="${it.id}" style="--i:${Math.min(i, 12)}">
          <div class="todo-main"><div class="todo-title" data-act="rename">${escapeHtml(it.title)}</div></div>
          <button type="button" class="icon-btn" data-act="up" aria-label="위로">▲</button>
          <button type="button" class="icon-btn" data-act="down" aria-label="아래로">▼</button>
          <button type="button" class="icon-btn del" data-act="del" aria-label="삭제">✕</button>
        </div>`,
        )
        .join('')
    : '<p class="empty small">아직 없어요<br>충전기·우산처럼 늘 챙기는 것을 적어 두세요</p>';
}

async function onListClick(e) {
  if (e.target.closest('[data-retry]')) return refresh();
  const row = e.target.closest('[data-id]');
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!row || !act) return;
  const id = Number(row.dataset.id);
  const item = state.items.find((x) => x.id === id);
  if (!item) return;

  try {
    if (act === 'rename') {
      const name = window.prompt('준비물 이름', item.title);
      if (name === null || !name.trim() || name.trim() === item.title) return;
      unwrap(await sb.from('packing_items').update({ title: name.trim() }).eq('id', id));
    } else if (act === 'del') {
      if (!confirmDialog(`"${item.title}" 을 목록에서 지울까요?\n지난 여행의 체크도 함께 사라져요.`)) return;
      unwrap(await sb.from('packing_items').delete().eq('id', id));
    } else {
      await move(id, act === 'up' ? -1 : 1);
    }
    await refresh();
  } catch (err) {
    console.error(err);
    toast('변경에 실패했어요. 다시 시도해 주세요');
  }
}

// 위아래로 한 칸. 자리가 바뀐 두 줄만 고친다.
async function move(id, dir) {
  const list = state.items;
  const at = list.findIndex((x) => x.id === id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= list.length) return;
  const next = [...list];
  [next[at], next[to]] = [next[to], next[at]];
  for (const [i, item] of next.entries()) {
    const order = (i + 1) * 10;
    if (order !== item.sort_order) unwrap(await sb.from('packing_items').update({ sort_order: order }).eq('id', item.id));
  }
}
