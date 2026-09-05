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
let bound = false;
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
  container.innerHTML = `
    ${rows.length ? rows.map((a) => `
      <div class="cat-item" data-id="${a.id}">
        <span class="name">${a.emoji || '📌'} ${escapeHtml(a.title)} <small class="muted">${a.date.slice(5).replace('-', '/')}${a.repeat ? ' 매년' : ''} · ${dLabel(a.next.days)}</small></span>
        <button type="button" class="icon-btn del" data-act="del" aria-label="삭제">✕</button>
      </div>`).join('') : '<p class="hint">등록된 기념일이 없어요</p>'}
    <form id="anniv-form" class="anniv-form">
      <div class="chips" id="anniv-emojis">${EMOJIS.map((e, i) => `<button type="button" class="chip ${i === 0 ? 'selected' : ''}" data-emoji="${e}">${e}</button>`).join('')}</div>
      <div class="row">
        <input id="anniv-title" type="text" placeholder="기념일 이름 (예: 결혼기념일)" maxlength="30" required>
      </div>
      <div class="row">
        <input id="anniv-date" type="date" required>
        <label class="check"><input id="anniv-repeat" type="checkbox" checked> 매년</label>
        <button type="submit" class="btn small primary">추가</button>
      </div>
    </form>`;

  const emojis = container.querySelector('#anniv-emojis');
  emojis.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-emoji]');
    if (!chip) return;
    emojis.querySelectorAll('.chip').forEach((c) => c.classList.toggle('selected', c === chip));
  });

  container.querySelector('#anniv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = container.querySelector('#anniv-title').value.trim();
    const date = container.querySelector('#anniv-date').value;
    if (!title || !date) return;
    const emoji = emojis.querySelector('.chip.selected')?.dataset.emoji ?? '';
    const repeat = container.querySelector('#anniv-repeat').checked;
    try {
      unwrap(await sb.from('anniversaries').insert({ title, date, emoji, repeat }));
      haptic();
      await renderManager(container);
    } catch (err) {
      console.error(err);
      toast('기념일을 추가하지 못했어요');
    }
  });

  container.onclick = async (e) => {
    const btn = e.target.closest('[data-act="del"]');
    if (!btn) return;
    const id = Number(btn.closest('.cat-item').dataset.id);
    const a = list.find((x) => x.id === id);
    if (!confirmDialog(`"${a.title}" 기념일을 삭제할까요?`)) return;
    try {
      unwrap(await sb.from('anniversaries').delete().eq('id', id));
      await renderManager(container);
    } catch (err) {
      console.error(err);
      toast('삭제에 실패했어요');
    }
  };
}
