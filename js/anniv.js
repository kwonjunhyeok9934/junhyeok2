// 기념일: 설정에서 등록·삭제, 홈에서 가장 가까운 것 표시.
import { sb } from './supabase.js';
import { $, escapeHtml, confirmDialog, toast, haptic } from './ui.js';
import { todayLocal, nextOccurrence } from './calc.js';

const EMOJIS = ['💍', '🎂', '❤️', '🎉', '✈️', '🏠', '🐶', '⭐'];

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export async function fetchAll() {
  return unwrap(await sb.from('anniversaries').select('*').order('date', { ascending: true }));
}

// 다가오는 순으로 정렬해 { ...row, next } 반환. 지난 한 번짜리는 뺀다.
export function upcoming(list, today = todayLocal()) {
  return list
    .map((a) => ({ ...a, next: nextOccurrence(a.date, today, a.repeat) }))
    .filter((a) => a.next)
    .sort((x, y) => x.next.days - y.next.days);
}

export function dLabel(days) {
  return days === 0 ? '오늘!' : `D-${days}`;
}

// ---- 설정 화면 ----
// 줄을 누르면 아래 입력 칸이 그 기념일로 채워지고, 추가 대신 저장이 된다.
// 예전에는 추가·삭제만 돼서 날짜 하나 틀려도 지우고 다시 만들어야 했다.
let editId = null;

export async function renderManager(container) {
  let list = [];
  try {
    list = await fetchAll();
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="hint">기념일을 불러오지 못했어요. 표가 만들어졌는지 확인해 주세요.</p>';
    return;
  }
  const today = todayLocal();
  const rows = upcoming(list, today);
  // 다시 그리는 사이에 다른 폰에서 지워졌으면 고치던 것을 놓는다.
  const editing = list.find((a) => a.id === editId) ?? null;
  if (!editing) editId = null;
  const emojiNow = editing ? (editing.emoji || '') : EMOJIS[0];
  // 목록에 없는 이모지로 저장된 것도 고칠 때 그대로 남도록 칩에 얹는다.
  const emojis = emojiNow && !EMOJIS.includes(emojiNow) ? [emojiNow, ...EMOJIS] : EMOJIS;
  container.innerHTML = `
    ${rows.length ? rows.map((a) => `
      <div class="cat-item${a.id === editId ? ' editing-row' : ''}" data-id="${a.id}">
        <span class="name" data-act="edit">${escapeHtml(a.emoji || '📌')} ${escapeHtml(a.title)} <small class="muted">${a.date.slice(5).replace('-', '/')}${a.repeat ? ' 매년' : ''} · ${dLabel(a.next.days)}</small></span>
        <button type="button" class="icon-btn" data-act="edit" aria-label="고치기">✎</button>
        <button type="button" class="icon-btn del" data-act="del" aria-label="삭제">✕</button>
      </div>`).join('') : '<p class="hint">등록된 기념일이 없어요</p>'}
    <form id="anniv-form" class="anniv-form">
      ${editing ? `<p class="hint">"${escapeHtml(editing.title)}" 고치는 중</p>` : ''}
      <div class="chips" id="anniv-emojis">${emojis.map((e) => `<button type="button" class="chip ${e === emojiNow ? 'selected' : ''}" data-emoji="${escapeHtml(e)}">${escapeHtml(e)}</button>`).join('')}</div>
      <div class="row">
        <input id="anniv-title" type="text" placeholder="기념일 이름 (예: 결혼기념일)" maxlength="30" required value="${escapeHtml(editing?.title ?? '')}">
      </div>
      <div class="row">
        <input id="anniv-date" type="date" required value="${escapeHtml(editing?.date ?? '')}">
        <label class="check"><input id="anniv-repeat" type="checkbox" ${editing ? (editing.repeat ? 'checked' : '') : 'checked'}> 매년</label>
        ${editing ? '<button type="button" class="btn small" data-act="cancel">취소</button>' : ''}
        <button type="submit" class="btn small primary">${editing ? '저장' : '추가'}</button>
      </div>
    </form>`;

  const emojiBox = container.querySelector('#anniv-emojis');
  emojiBox.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-emoji]');
    if (!chip) return;
    emojiBox.querySelectorAll('.chip').forEach((c) => c.classList.toggle('selected', c === chip));
  });

  container.querySelector('#anniv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = container.querySelector('#anniv-title').value.trim();
    const date = container.querySelector('#anniv-date').value;
    if (!title || !date) return;
    const emoji = emojiBox.querySelector('.chip.selected')?.dataset.emoji ?? '';
    const repeat = container.querySelector('#anniv-repeat').checked;
    try {
      if (editId) {
        unwrap(await sb.from('anniversaries').update({ title, date, emoji, repeat }).eq('id', editId));
        toast('고쳤어요');
      } else {
        unwrap(await sb.from('anniversaries').insert({ title, date, emoji, repeat }));
      }
      editId = null;
      haptic();
      await renderManager(container);
    } catch (err) {
      console.error(err);
      toast(editId ? '기념일을 고치지 못했어요' : '기념일을 추가하지 못했어요');
    }
  });

  container.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') {
      editId = null;
      await renderManager(container);
      return;
    }
    const row = btn.closest('.cat-item');
    if (!row) return;
    const id = Number(row.dataset.id);
    const a = list.find((x) => x.id === id);
    if (!a) return;
    if (btn.dataset.act === 'edit') {
      editId = editId === id ? null : id; // 고치던 줄을 다시 누르면 그만둔다
      await renderManager(container);
      if (editId) container.querySelector('#anniv-title')?.focus();
      return;
    }
    if (btn.dataset.act !== 'del') return;
    if (!confirmDialog(`"${a.title}" 기념일을 삭제할까요?`)) return;
    try {
      unwrap(await sb.from('anniversaries').delete().eq('id', id));
      if (editId === id) editId = null;
      await renderManager(container);
    } catch (err) {
      console.error(err);
      toast('삭제에 실패했어요');
    }
  };
}
