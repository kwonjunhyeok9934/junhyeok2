// 홈 탭: 오늘 날짜, 이번 달 지출, 오늘 일정, 해야 할 일, 고정비를 한눈에.
import { sb } from './supabase.js';
import { $, escapeHtml, animateNumber, toast } from './ui.js';
import { getWeather, hasLocation, requestLocation, pm10Grade, pm25Grade } from './weather.js';
import { monthRange, shiftMonth, todayLocal, shiftDay, summarize, sortTodos, dueLabel, groupEventsByDate, formatTime, formatWon } from './calc.js';

let el = null;
let goTab = () => {};
let initialized = false;

export function init({ onGo }) {
  goTab = onGo;
  if (initialized) return;
  initialized = true;
  el = { root: $('#tab-home') };
  el.root.addEventListener('click', async (e) => {
    if (e.target.closest('#weather-allow')) {
      e.stopPropagation();
      const btn = e.target.closest('#weather-allow');
      btn.disabled = true;
      try {
        await requestLocation();
        await renderWeather();
      } catch (err) {
        console.warn(err);
        toast(err?.code === 1 ? '위치 권한을 허용해 주세요' : '위치를 가져오지 못했어요');
        btn.disabled = false;
      }
      return;
    }
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
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const { start, end } = monthRange(y, m);
  // 지난달 같은 날짜까지 (비교용)
  const prev = shiftMonth(y, m, -1);
  const prevRange = monthRange(prev.year, prev.month);
  const prevSameDay = `${prevRange.start.slice(0, 7)}-${today.slice(8, 10)}`;
  try {
    const [txs, prevTxs, todos, events, profiles] = await Promise.all([
      sb.from('transactions').select('kind,amount,date').gte('date', start).lte('date', end).then(unwrap),
      sb.from('transactions').select('kind,amount').eq('kind', 'expense').gte('date', prevRange.start).lte('date', prevSameDay < prevRange.end ? prevSameDay : prevRange.end).then(unwrap),
      sb.from('todos').select('*').eq('done', false).then(unwrap),
      sb.from('events').select('*').gte('date', today).lte('date', tomorrow).order('created_at').then(unwrap),
      sb.from('profiles').select('id,name,color').then(unwrap),
    ]);
    render({ today, tomorrow, txs, prevTxs, todos, events, profiles });
  } catch (err) {
    console.error(err);
    el.root.innerHTML = '<div class="retry">불러오지 못했어요<br><button type="button" class="btn small" onclick="location.reload()">다시 시도</button></div>';
  }
}

function render({ today, tomorrow, txs, prevTxs, todos, events, profiles }) {
  const sum = summarize(txs);
  const todayExpense = txs.filter((t) => t.kind === 'expense' && t.date === today).reduce((a, t) => a + t.amount, 0);
  const { open } = sortTodos(todos);
  const byDate = groupEventsByDate(events);
  const todayEv = byDate.get(today) ?? [];
  const tomorrowEv = byDate.get(tomorrow) ?? [];
  const profile = new Map(profiles.map((p) => [p.id, p]));
  const [y, m, d] = today.split('-').map(Number);
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];
  const hour = new Date().getHours();
  const greet = hour < 5 ? '편안한 밤이에요 🌙' : hour < 11 ? '좋은 아침이에요 ☀️' : hour < 17 ? '좋은 오후예요 🌤️' : hour < 22 ? '좋은 저녁이에요 🌆' : '편안한 밤이에요 🌙';
  const prevExpense = prevTxs.reduce((a, t) => a + t.amount, 0);
  let compare = '';
  if (prevExpense > 0 && sum.expense > 0) {
    const pct = Math.round(((sum.expense - prevExpense) / prevExpense) * 100);
    compare = pct <= -5 ? `지난달 이맘때보다 ${-pct}% 적게 썼어요 👍` : pct >= 5 ? `지난달 이맘때보다 ${pct}% 더 썼어요` : '지난달 이맘때와 비슷해요';
  } else if (sum.expense === 0) {
    compare = '이번 달 첫 기록을 기다리고 있어요';
  }

  const evRow = (e) => {
    const p = e.owner ? profile.get(e.owner) : null;
    return `<li><span class="ev-time ${e.time ? '' : 'allday'}">${formatTime(e.time)}</span><span class="grow">${escapeHtml(e.title)}</span>${p ? `<span class="dot" style="background:${escapeHtml(p.color)}"></span>` : ''}</li>`;
  };
  const todoRow = (t) => {
    const due = dueLabel(t.due, today);
    return `<li><span class="ring"></span><span class="grow">${escapeHtml(t.title)}</span>${due ? `<span class="due ${due.overdue ? 'overdue' : ''}">${due.text}</span>` : ''}</li>`;
  };

  const ICON = {
    schedule: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    todo: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>',
    fixed: '<svg viewBox="0 0 24 24"><path d="M12 3v18M5 8l7-5 7 5M6 21h12"/><path d="M8 12h8"/></svg>',
  };

  el.root.innerHTML = `
    <div class="hero home-card" data-go="ledger" style="--i:0">
      <div class="hero-top"><span>${greet}</span><span class="hero-date">${m}월 ${d}일 ${dow}요일</span></div>
      <div class="hero-label">이번 달 지출</div>
      <div class="hero-amount"><span id="home-expense">0</span><small>원</small></div>
      <div class="hero-sub">오늘 ${formatWon(todayExpense)}원 · 하루 평균 ${formatWon(Math.round(sum.expense / d))}원${sum.income ? ` · 남은 돈 ${formatWon(sum.balance)}원` : ''}</div>
      ${compare ? `<div class="hero-compare">${compare}</div>` : ''}
    </div>

    <div id="home-weather" class="card home-card weather" style="--i:1">${weatherPlaceholder()}</div>

    <div class="card home-card" data-go="schedule" style="--i:2">
      <div class="tile violet">${ICON.schedule}</div>
      <div class="home-body">
        <h2>오늘 일정 ${todayEv.length ? `<span class="count">${todayEv.length}</span>` : ''}</h2>
        ${todayEv.length ? `<ul class="home-list">${todayEv.slice(0, 3).map(evRow).join('')}</ul>` : '<p class="home-empty">오늘은 일정이 없어요. 여유로운 하루!</p>'}
        ${tomorrowEv.length ? `<div class="home-sub">내일 ${tomorrowEv.length}개 · ${escapeHtml(tomorrowEv[0].title)}${tomorrowEv.length > 1 ? ' 외' : ''}</div>` : ''}
      </div>
    </div>

    <div class="card home-card" data-go="todo" style="--i:3">
      <div class="tile green">${ICON.todo}</div>
      <div class="home-body">
        <h2>해야 할 일 ${open.length ? `<span class="count">${open.length}</span>` : ''}</h2>
        ${open.length ? `<ul class="home-list">${open.slice(0, 3).map(todoRow).join('')}</ul>` : '<p class="home-empty">남은 할일이 없어요 ✨</p>'}
        ${open.length > 3 ? `<div class="home-sub">외 ${open.length - 3}개</div>` : ''}
      </div>
    </div>`;

  animateNumber($('#home-expense'), sum.expense, formatWon);
  renderWeather();
}

function weatherPlaceholder() {
  if (!hasLocation()) {
    return `<div class="tile sky">🌤️</div>
      <div class="home-body">
        <h2>오늘 날씨</h2>
        <p class="home-empty">위치를 허용하면 우리 동네 날씨와 미세먼지를 보여줘요</p>
        <button type="button" id="weather-allow" class="btn small primary" style="margin-top:8px">위치 허용하고 날씨 보기</button>
      </div>`;
  }
  return `<div class="tile sky">🌤️</div><div class="home-body"><h2>오늘 날씨</h2><p class="home-empty">불러오는 중…</p></div>`;
}

const GRADE_CLASS = { 좋음: 'good', 보통: 'fair', 나쁨: 'bad', 매우나쁨: 'worst' };

async function renderWeather() {
  const box = $('#home-weather');
  if (!box || !hasLocation()) return;
  try {
    const w = await getWeather();
    if (!w) return;
    const dust = w.pm10 !== null
      ? `<span class="grade ${GRADE_CLASS[pm10Grade(w.pm10)]}">미세먼지 ${pm10Grade(w.pm10)}</span><span class="grade ${GRADE_CLASS[pm25Grade(w.pm25)]}">초미세 ${pm25Grade(w.pm25)}</span>`
      : '';
    box.innerHTML = `
      <div class="tile sky big-emoji">${w.emoji}</div>
      <div class="home-body">
        <h2>오늘 날씨 ${w.place ? `<span class="place">${escapeHtml(w.place)}</span>` : ''}</h2>
        <div class="weather-main"><strong>${w.temp}°</strong><span>${w.text}</span><span class="home-sub" style="margin:0">최고 ${w.tmax}° · 최저 ${w.tmin}°${w.pop ? ` · 비 ${w.pop}%` : ''}</span></div>
        ${dust ? `<div class="grades">${dust}</div>` : ''}
      </div>`;
  } catch (err) {
    console.warn(err);
    box.innerHTML = `<div class="tile sky">🌤️</div><div class="home-body"><h2>오늘 날씨</h2><p class="home-empty">날씨를 불러오지 못했어요</p></div>`;
  }
}
