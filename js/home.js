// 홈 탭: 오늘 날짜, 이번 달 지출, 오늘 일정, 해야 할 일, 고정비를 한눈에.
import { sb } from './supabase.js';
import { $, escapeHtml, animateNumber } from './ui.js';
import { monthRange, todayLocal, shiftDay, summarize, sortTodos, dueLabel, groupEventsByDate, formatTime, formatWon } from './calc.js';

let el = null;
let goTab = () => {};
let initialized = false;

export function init({ onGo }) {
  goTab = onGo;
  if (initialized) return;
  initialized = true;
  el = { root: $('#tab-home') };
  el.root.addEventListener('click', (e) => {
    const card = e.target.closest('[data-go]');
    if (card) goTab(card.dataset.go);
  });
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export async function refresh() {
  const today = todayLocal();
  const tomorrow = shiftDay(today, 1);
  const { start, end } = monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  try {
    const [txs, todos, events, fixed, profiles] = await Promise.all([
      sb.from('transactions').select('kind,amount,date').gte('date', start).lte('date', end).then(unwrap),
      sb.from('todos').select('*').eq('done', false).then(unwrap),
      sb.from('events').select('*').gte('date', today).lte('date', tomorrow).order('created_at').then(unwrap),
      sb.from('fixed_costs').select('amount,owner').then(unwrap),
      sb.from('profiles').select('id,name,color').then(unwrap),
    ]);
    render({ today, tomorrow, txs, todos, events, fixed, profiles });
  } catch (err) {
    console.error(err);
    el.root.innerHTML = '<div class="retry">불러오지 못했어요<br><button type="button" class="btn small" onclick="location.reload()">다시 시도</button></div>';
  }
}

function render({ today, tomorrow, txs, todos, events, fixed, profiles }) {
  const sum = summarize(txs);
  const todayExpense = txs.filter((t) => t.kind === 'expense' && t.date === today).reduce((a, t) => a + t.amount, 0);
  const { open } = sortTodos(todos);
  const byDate = groupEventsByDate(events);
  const todayEv = byDate.get(today) ?? [];
  const tomorrowEv = byDate.get(tomorrow) ?? [];
  const profile = new Map(profiles.map((p) => [p.id, p]));
  const fixedTotal = fixed.reduce((a, x) => a + x.amount, 0);
  const owners = [{ id: null, name: '공통' }, ...profiles].map((o) => ({
    ...o, total: fixed.filter((x) => (x.owner ?? null) === o.id).reduce((a, x) => a + x.amount, 0),
  }));
  const [y, m, d] = today.split('-').map(Number);
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];

  const evRow = (e) => {
    const p = e.owner ? profile.get(e.owner) : null;
    return `<li><span class="ev-time ${e.time ? '' : 'allday'}">${formatTime(e.time)}</span><span class="grow">${escapeHtml(e.title)}</span>${p ? `<span class="dot" style="background:${escapeHtml(p.color)}"></span>` : ''}</li>`;
  };
  const todoRow = (t) => {
    const due = dueLabel(t.due, today);
    return `<li><span class="ring"></span><span class="grow">${escapeHtml(t.title)}</span>${due ? `<span class="due ${due.overdue ? 'overdue' : ''}">${due.text}</span>` : ''}</li>`;
  };

  el.root.innerHTML = `
    <div class="home-date">${m}월 ${d}일 ${dow}요일</div>

    <div class="card home-card" data-go="ledger" style="--i:0">
      <span class="sum-label">이번 달 지출</span>
      <strong id="home-expense" class="big">0</strong>
      <div class="home-sub">오늘 ${formatWon(todayExpense)} · 남은 돈 <span class="${sum.balance < 0 ? 'neg' : ''}">${formatWon(sum.balance)}</span></div>
    </div>

    <div class="card home-card" data-go="schedule" style="--i:1">
      <h2>오늘 일정 ${todayEv.length ? `<span class="count">${todayEv.length}</span>` : ''}</h2>
      ${todayEv.length ? `<ul class="home-list">${todayEv.slice(0, 3).map(evRow).join('')}</ul>` : '<p class="home-empty">오늘 일정이 없어요</p>'}
      ${tomorrowEv.length ? `<div class="home-sub">내일 ${tomorrowEv.length}개 · ${escapeHtml(tomorrowEv[0].title)}${tomorrowEv.length > 1 ? ' 외' : ''}</div>` : ''}
    </div>

    <div class="card home-card" data-go="todo" style="--i:2">
      <h2>해야 할 일 ${open.length ? `<span class="count">${open.length}</span>` : ''}</h2>
      ${open.length ? `<ul class="home-list">${open.slice(0, 3).map(todoRow).join('')}</ul>` : '<p class="home-empty">남은 할일이 없어요</p>'}
      ${open.length > 3 ? `<div class="home-sub">외 ${open.length - 3}개</div>` : ''}
    </div>

    <div class="card home-card" data-go="fixed" style="--i:3">
      <span class="sum-label">월 고정비</span>
      <strong id="home-fixed" class="big">0</strong>
      <div class="home-sub">${owners.map((o) => `${escapeHtml(o.name)} ${formatWon(o.total)}`).join(' · ')}</div>
    </div>`;

  animateNumber($('#home-expense'), sum.expense, formatWon);
  animateNumber($('#home-fixed'), fixedTotal, formatWon);
}
