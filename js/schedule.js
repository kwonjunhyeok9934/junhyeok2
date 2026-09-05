// 스케줄 탭: 월간 달력, 선택한 날 일정 목록, 일정 시트.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic } from './ui.js';
import { monthRange, shiftMonth, monthLabel, todayLocal, calendarGrid, groupEventsByDate, formatTime } from './calc.js';

const state = { year: 0, month: 0, selected: '', events: [], profiles: [], userId: null, editing: null };
let el = null;
let initialized = false;

export function init({ userId }) {
  state.userId = userId;
  if (initialized) return;
  initialized = true;

  const today = todayLocal();
  state.year = Number(today.slice(0, 4));
  state.month = Number(today.slice(5, 7));
  state.selected = today;

  el = {
    label: $('#cal-label'),
    grid: $('#cal-grid'),
    dayLabel: $('#day-label'),
    list: $('#event-list'),
    sheet: $('#sheet-event'),
    form: $('#event-form'),
    id: $('#event-id'),
    title: $('#event-title'),
    date: $('#event-date'),
    time: $('#event-time'),
    allDay: $('#event-allday'),
    owner: $('#event-owner'),
    memo: $('#event-memo'),
    save: $('#event-save'),
    del: $('#event-delete'),
  };

  $('#cal-prev').addEventListener('click', () => moveMonth(-1));
  $('#cal-next').addEventListener('click', () => moveMonth(1));
  bindSheetBackdrop(el.sheet);

  el.grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-cell');
    if (!cell) return;
    state.selected = cell.dataset.date;
    haptic(5);
    render();
  });

  el.list.addEventListener('click', (e) => {
    const row = e.target.closest('.event-row');
    if (row) openEventSheet(state.events.find((x) => x.id === Number(row.dataset.id)));
    if (e.target.closest('[data-retry]')) refresh();
  });

  el.title.addEventListener('input', () => {
    el.save.disabled = !el.title.value.trim();
  });
  el.allDay.addEventListener('click', () => {
    el.time.value = '';
  });
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  el.del.addEventListener('click', remove);
}

function moveMonth(delta) {
  const { year, month } = shiftMonth(state.year, state.month, delta);
  state.year = year;
  state.month = month;
  // 선택한 날도 그 달로 옮긴다: 오늘이 있는 달이면 오늘, 아니면 1일.
  const today = todayLocal();
  const { start } = monthRange(year, month);
  state.selected = today.slice(0, 7) === start.slice(0, 7) ? today : start;
  refresh();
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export async function refresh() {
  const { start, end } = monthRange(state.year, state.month);
  el.label.textContent = monthLabel(state.year, state.month);
  try {
    const [profiles, events] = await Promise.all([
      sb.from('profiles').select('id,name,color').then(unwrap),
      sb.from('events').select('*').gte('date', start).lte('date', end).order('created_at', { ascending: true }).then(unwrap),
    ]);
    state.profiles = profiles;
    state.events = events;
    render();
  } catch (err) {
    console.error(err);
    el.list.innerHTML = `
      <div class="retry">불러오지 못했어요<br>
        <button type="button" class="btn small" data-retry>다시 시도</button>
      </div>`;
  }
}

const BOTH_COLOR = '#9ca3af';

function render() {
  const today = todayLocal();
  const byDate = groupEventsByDate(state.events);
  const profile = new Map(state.profiles.map((p) => [p.id, p]));
  const colorOf = (e) => (e.owner && profile.get(e.owner) ? profile.get(e.owner).color : BOTH_COLOR);

  el.grid.innerHTML = calendarGrid(state.year, state.month)
    .map((c) => {
      const dots = (byDate.get(c.date) ?? []).slice(0, 3)
        .map((e) => `<i style="background:${escapeHtml(colorOf(e))}"></i>`)
        .join('');
      const cls = ['cal-cell', c.inMonth ? '' : 'dim', c.date === today ? 'today' : '', c.date === state.selected ? 'selected' : '']
        .filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-date="${c.date}"><span>${c.day}</span><div class="dots">${dots}</div></button>`;
    })
    .join('');

  el.dayLabel.textContent = dayLabel(state.selected);
  const list = byDate.get(state.selected) ?? [];
  el.list.innerHTML = list.length
    ? list.map((e, i) => {
        const p = e.owner ? profile.get(e.owner) : null;
        return `
        <div class="event-row" data-id="${e.id}" style="--i:${Math.min(i, 12)}">
          <div class="event-time ${e.time ? '' : 'allday'}">${formatTime(e.time)}</div>
          <div class="event-main">
            <div class="event-title">${escapeHtml(e.title)}</div>
            ${e.memo ? `<div class="event-memo">${escapeHtml(e.memo)}</div>` : ''}
          </div>
          ${p ? `<div class="avatar" style="background:${escapeHtml(p.color)}" title="${escapeHtml(p.name)}">${escapeHtml(p.name.slice(0, 1))}</div>` : ''}
        </div>`;
      }).join('')
    : '<p class="empty small">일정이 없어요</p>';
}

function dayLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  const day = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일 (${day})`;
}

// ---- 시트 -----------------------------------------------------------------

export function openNew() {
  openEventSheet(null);
}

function openEventSheet(ev) {
  state.editing = ev ?? null;
  el.id.value = ev?.id ?? '';
  el.title.value = ev?.title ?? '';
  el.date.value = ev?.date ?? state.selected;
  el.time.value = ev?.time ? formatTime(ev.time) : '';
  el.memo.value = ev?.memo ?? '';
  el.save.disabled = !ev;
  el.del.hidden = !ev;
  renderOwner(ev?.owner ?? null);
  openSheet(el.sheet);
  if (!ev) setTimeout(() => el.title.focus(), 250);
}

function renderOwner(selected) {
  const options = [{ id: '', name: '둘 다' }, ...state.profiles];
  el.owner.innerHTML = options
    .map(
      (o) => `
      <label><input type="radio" name="owner" value="${o.id}" ${String(selected ?? '') === String(o.id) ? 'checked' : ''}>
      <span>${escapeHtml(o.name)}</span></label>`,
    )
    .join('');
}

async function save() {
  const title = el.title.value.trim();
  if (!title || !el.date.value) return;
  const payload = {
    title,
    date: el.date.value,
    time: el.time.value || null,
    owner: el.form.querySelector('input[name="owner"]:checked')?.value || null,
    memo: el.memo.value.trim(),
  };
  el.save.disabled = true;
  try {
    if (state.editing) unwrap(await sb.from('events').update(payload).eq('id', state.editing.id));
    else unwrap(await sb.from('events').insert({ ...payload, created_by: state.userId }));
    haptic();
    closeSheet(el.sheet);
    state.selected = payload.date;
    state.year = Number(payload.date.slice(0, 4));
    state.month = Number(payload.date.slice(5, 7));
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
  if (!confirmDialog('이 일정을 삭제할까요?')) return;
  try {
    unwrap(await sb.from('events').delete().eq('id', state.editing.id));
    closeSheet(el.sheet);
    await refresh();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
}
