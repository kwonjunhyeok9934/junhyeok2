// 할일 탭: 빠른 입력, 목록(미완료/완료), 체크 토글, 편집 시트.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog } from './ui.js';
import { todayLocal, dueLabel, sortTodos } from './calc.js';

const state = { todos: [], profiles: [], userId: null, editing: null };
let el = null;
let initialized = false;

export function init({ userId }) {
  state.userId = userId;
  if (initialized) return;
  initialized = true;

  el = {
    quick: $('#todo-quick'),
    quickTitle: $('#todo-quick-title'),
    list: $('#todo-list'),
    doneWrap: $('#todo-done'),
    doneList: $('#todo-done-list'),
    doneCount: $('#todo-done-count'),
    clearDone: $('#todo-clear-done'),
    sheet: $('#sheet-todo'),
    form: $('#todo-form'),
    id: $('#todo-id'),
    title: $('#todo-title'),
    assignee: $('#todo-assignee'),
    due: $('#todo-due'),
    dueClear: $('#todo-due-clear'),
    save: $('#todo-save'),
    del: $('#todo-delete'),
  };

  bindSheetBackdrop(el.sheet);

  el.quick.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = el.quickTitle.value.trim();
    if (!title) return;
    el.quickTitle.value = '';
    try {
      unwrap(await sb.from('todos').insert({ title, created_by: state.userId }));
      await refresh();
    } catch (err) {
      console.error(err);
      el.quickTitle.value = title;
      toast('저장에 실패했어요. 다시 시도해 주세요');
    }
  });

  const onListClick = (e) => {
    const row = e.target.closest('.todo-row');
    if (!row) {
      if (e.target.closest('[data-retry]')) refresh();
      return;
    }
    const todo = state.todos.find((t) => t.id === Number(row.dataset.id));
    if (!todo) return;
    if (e.target.closest('.todo-check')) toggleDone(todo);
    else openTodoSheet(todo);
  };
  el.list.addEventListener('click', onListClick);
  el.doneList.addEventListener('click', onListClick);

  el.clearDone.addEventListener('click', async () => {
    const ids = state.todos.filter((t) => t.done).map((t) => t.id);
    if (!ids.length) return;
    if (!confirmDialog(`완료된 할일 ${ids.length}개를 삭제할까요?`)) return;
    try {
      unwrap(await sb.from('todos').delete().in('id', ids));
      await refresh();
    } catch (err) {
      console.error(err);
      toast('삭제에 실패했어요. 다시 시도해 주세요');
    }
  });

  el.title.addEventListener('input', () => {
    el.save.disabled = !el.title.value.trim();
  });
  el.dueClear.addEventListener('click', () => {
    el.due.value = '';
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
    const [profiles, todos] = await Promise.all([
      sb.from('profiles').select('id,name,color').then(unwrap),
      sb.from('todos').select('*').order('created_at', { ascending: true }).then(unwrap),
    ]);
    state.profiles = profiles;
    state.todos = todos;
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
  const { open, done } = sortTodos(state.todos);
  const today = todayLocal();
  const profile = new Map(state.profiles.map((p) => [p.id, p]));

  el.list.innerHTML = open.length
    ? open.map((t) => row(t, today, profile)).join('')
    : '<p class="empty">할일이 없어요. 위에 적어 보세요</p>';

  el.doneWrap.hidden = done.length === 0;
  el.doneCount.textContent = done.length;
  el.doneList.innerHTML = done.map((t) => row(t, today, profile)).join('');
}

function row(t, today, profile) {
  const due = dueLabel(t.due, today);
  const p = t.assignee ? profile.get(t.assignee) : null;
  return `
    <div class="todo-row ${t.done ? 'done' : ''}" data-id="${t.id}">
      <button type="button" class="todo-check" aria-label="${t.done ? '완료 해제' : '완료'}">${t.done ? '✓' : ''}</button>
      <div class="todo-main">
        <div class="todo-title">${escapeHtml(t.title)}</div>
        ${due && !t.done ? `<div class="todo-due ${due.overdue ? 'overdue' : ''}">${due.text}</div>` : ''}
      </div>
      ${p ? `<div class="avatar" style="background:${escapeHtml(p.color)}" title="${escapeHtml(p.name)}">${escapeHtml(p.name.slice(0, 1))}</div>` : ''}
    </div>`;
}

async function toggleDone(todo) {
  const done = !todo.done;
  try {
    unwrap(await sb.from('todos').update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', todo.id));
    await refresh();
  } catch (err) {
    console.error(err);
    toast('변경에 실패했어요. 다시 시도해 주세요');
  }
}

// ---- 편집 시트 ------------------------------------------------------------

function openTodoSheet(todo) {
  state.editing = todo;
  el.id.value = todo.id;
  el.title.value = todo.title;
  el.due.value = todo.due ?? '';
  el.save.disabled = false;
  renderAssignee(todo.assignee);
  openSheet(el.sheet);
}

function renderAssignee(selected) {
  const options = [{ id: '', name: '둘 다' }, ...state.profiles];
  el.assignee.innerHTML = options
    .map(
      (o) => `
      <label><input type="radio" name="assignee" value="${o.id}" ${String(selected ?? '') === String(o.id) ? 'checked' : ''}>
      <span>${escapeHtml(o.name)}</span></label>`,
    )
    .join('');
}

async function save() {
  if (!state.editing) return;
  const title = el.title.value.trim();
  if (!title) return;
  const assignee = el.form.querySelector('input[name="assignee"]:checked')?.value || null;
  const due = el.due.value || null;
  el.save.disabled = true;
  try {
    unwrap(await sb.from('todos').update({ title, assignee, due }).eq('id', state.editing.id));
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
  if (!confirmDialog('이 할일을 삭제할까요?')) return;
  try {
    unwrap(await sb.from('todos').delete().eq('id', state.editing.id));
    closeSheet(el.sheet);
    await refresh();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
}
