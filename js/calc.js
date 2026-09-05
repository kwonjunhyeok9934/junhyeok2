// 순수 계산 함수. DOM·Supabase를 모른다. tests/calc.test.js 로 검증.

const pad2 = (n) => String(n).padStart(2, '0');

export function monthRange(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${pad2(month)}-01`,
    end: `${year}-${pad2(month)}-${pad2(lastDay)}`,
  };
}

export function shiftMonth(year, month, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function monthLabel(year, month) {
  return `${year}년 ${month}월`;
}

export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function summarize(txs) {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.kind === 'income') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, balance: income - expense };
}

export function sumByCategory(txs, categories) {
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  const totals = new Map();
  for (const t of txs) {
    if (t.kind !== 'expense') continue;
    const key = t.category_id ?? null;
    totals.set(key, (totals.get(key) ?? 0) + t.amount);
  }
  return [...totals.entries()]
    .map(([id, total]) => ({ id, name: id === null ? '미분류' : (nameOf.get(id) ?? '미분류'), total }))
    .sort((a, b) => b.total - a.total);
}

export function groupByDate(txs) {
  const byDate = new Map();
  for (const t of txs) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, items]) => ({
      date,
      items: items.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)),
    }));
}

export function formatWon(n) {
  return Math.trunc(n).toLocaleString('en-US');
}

export function parseWon(str) {
  const digits = String(str).replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

// ---- 할일 -------------------------------------------------------------------

// due('YYYY-MM-DD' | null) 를 today 기준 라벨로. null 이면 null.
export function dueLabel(due, today) {
  if (!due) return null;
  const days = Math.round((Date.parse(due) - Date.parse(today)) / 86400000);
  if (days < 0) return { text: `${-days}일 지남`, overdue: true };
  if (days === 0) return { text: '오늘', overdue: false };
  if (days === 1) return { text: '내일', overdue: false };
  return { text: `${Number(due.slice(5, 7))}월 ${Number(due.slice(8, 10))}일`, overdue: false };
}

// 미완료: 마감 있는 것(가까운 순) → 마감 없는 것(만든 순). 완료: 완료 시각 최신순.
export function sortTodos(todos) {
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const open = todos
    .filter((t) => !t.done)
    .sort((a, b) => {
      if (a.due && b.due) return cmp(a.due, b.due) || cmp(a.created_at, b.created_at);
      if (a.due) return -1;
      if (b.due) return 1;
      return cmp(a.created_at, b.created_at);
    });
  const done = todos.filter((t) => t.done).sort((a, b) => cmp(b.done_at ?? '', a.done_at ?? ''));
  return { open, done };
}

// ---- 스케줄 -----------------------------------------------------------------

// 일요일 시작 6줄(42칸) 달력. 각 칸 { date, day, inMonth }.
export function calendarGrid(year, month) {
  const first = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({
      date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      day: d.getDate(),
      inMonth: d.getMonth() === month - 1,
    });
  }
  return cells;
}

// date → 그날 일정 목록(종일 먼저, 그 다음 시간순, 같으면 만든 순).
export function groupEventsByDate(events) {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (!a.time && b.time) return -1;
      if (a.time && !b.time) return 1;
      return cmp(a.time ?? '', b.time ?? '') || cmp(a.created_at, b.created_at);
    });
  }
  return map;
}

// 'HH:MM:SS' | 'HH:MM' | null → 'HH:MM' | '종일'
export function formatTime(t) {
  return t ? String(t).slice(0, 5) : '종일';
}

// ---- 조회 기간 ---------------------------------------------------------------

// year/month 를 끝 달로 하는 span 개월 범위. span=1 이면 monthRange 와 같다.
export function spanRange(year, month, span) {
  const first = shiftMonth(year, month, -(span - 1));
  return { start: monthRange(first.year, first.month).start, end: monthRange(year, month).end };
}

// 범위 라벨. 한 달이면 "2026년 9월", 여러 달이면 "2026년 7월 ~ 9월" / "2025년 10월 ~ 2026년 9월",
// 직접 지정이면 "2026.07.01 ~ 2026.09.15".
export function rangeLabel(start, end, custom = false) {
  if (custom) return `${start.replaceAll('-', '.')} ~ ${end.replaceAll('-', '.')}`;
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  if (sy === ey && sm === em) return monthLabel(ey, em);
  if (sy === ey) return `${sy}년 ${sm}월 ~ ${em}월`;
  return `${monthLabel(sy, sm)} ~ ${monthLabel(ey, em)}`;
}
