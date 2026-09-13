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

// 'YYYY-MM-DD' 에 며칠을 더한다.
export function shiftDay(date, delta) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d + delta);
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
}

export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 'YYYY-MM-DD' → '월' 같은 요일 한 글자.
export function dayName(date) {
  const [y, m, d] = date.split('-').map(Number);
  return ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];
}

// 'YYYY-MM-DD' → '9월 13일 (일)'
export function dayLabel(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일 (${dayName(date)})`;
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

// ---- 월별 비교 ---------------------------------------------------------------

// start~end 사이 달을 'YYYY-MM' 로 순서대로.
export function monthsBetween(start, end) {
  const out = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4));
  const em = Number(end.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${pad2(m)}`);
    ({ year: y, month: m } = shiftMonth(y, m, 1));
  }
  return out;
}

// 범위 안 달마다 { ym, expense, income }. 기록 없는 달은 0.
export function sumByMonth(txs, start, end) {
  const map = new Map(monthsBetween(start, end).map((ym) => [ym, { ym, expense: 0, income: 0 }]));
  for (const t of txs) {
    const row = map.get(t.date.slice(0, 7));
    if (!row) continue;
    if (t.kind === 'income') row.income += t.amount;
    else row.expense += t.amount;
  }
  return [...map.values()];
}

// ---- 기념일 -----------------------------------------------------------------

// 다음 기념일. repeat 이면 올해/내년 중 가까운 날, 아니면 date 자체(지났으면 null).
// { date, days(D-), years(몇 주년, 반복일 때), together(처음 날부터 며칠째) }
export function nextOccurrence(date, today, repeat = true) {
  const dayMs = 86400000;
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs);
  if (!repeat) {
    const days = daysBetween(today, date);
    return days < 0 ? null : { date, days, years: 0, together: 0 };
  }
  const [oy, om, od] = date.split('-').map(Number);
  const ty = Number(today.slice(0, 4));
  const mk = (y) => `${y}-${pad2(om)}-${pad2(od)}`;
  let next = mk(ty);
  if (next < today) next = mk(ty + 1);
  const years = Number(next.slice(0, 4)) - oy;
  const together = date <= today ? daysBetween(date, today) + 1 : 0;
  return { date: next, days: daysBetween(today, next), years, together };
}

// ---- 식비(주간) ---------------------------------------------------------------
// 금액은 meals 에 없다. 돈을 쓴 끼니는 transactions 행 하나와 1:1 로 연결되고,
// 조회할 때 m.tx 로 함께 딸려 온다. 연결이 없으면 돈을 안 쓴 끼니다.

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'night'];
export const SLOT_LABEL = { breakfast: '아침', lunch: '점심', dinner: '저녁', night: '야식', grocery: '장보기' };

// 그 날짜가 속한 주의 월요일. (스케줄 탭 달력은 일요일 시작이지만 식비는 월요일 시작이다.)
export function weekStart(date) {
  const [y, m, d] = date.split('-').map(Number);
  const back = (new Date(y, m - 1, d).getDay() + 6) % 7; // 일=0 → 6칸 뒤, 월=1 → 0칸
  return shiftDay(date, -back);
}

// 월요일부터 7일.
export function weekDays(start) {
  return Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
}

// '9월 8일 ~ 14일', 달이 바뀌면 '8월 31일 ~ 9월 6일'.
export function weekLabel(start) {
  const [, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = shiftDay(start, 6).split('-').map(Number);
  return sm === em ? `${sm}월 ${sd}일 ~ ${ed}일` : `${sm}월 ${sd}일 ~ ${em}월 ${ed}일`;
}

// 시각(0~23) → 기본으로 고를 끼니.
export function slotOfHour(h) {
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'night';
}

// 가계부에 남길 메모. 빈 조각은 뺀다. → '점심 · 제육덮밥 · 배달'
export function mealMemo({ slot, menu, bought, cat }) {
  return [SLOT_LABEL[slot] ?? '', (menu || bought || '').trim(), cat || '']
    .filter(Boolean)
    .join(' · ')
    .slice(0, 60);
}

// 가계부에 넣을 분류. 이미 연결된 거래가 있으면 그 분류를 유지한다
// (가계부에서 사람이 바꿔 놓은 것을 식비 탭이 되돌리지 않는다).
export function resolveMealCategoryId(cats, editingTx) {
  if (editingTx) return editingTx.category_id ?? null;
  return cats.find((c) => c.kind === 'expense' && c.name === '식비')?.id ?? null;
}

// 그 끼니에 쓴 돈. 가계부에서 '수입'으로 바뀐 거래는 세지 않는다.
export function mealAmount(m) {
  return m.tx && m.tx.kind === 'expense' ? m.tx.amount : 0;
}

// 'date|slot' 로 묶는다. 한 끼에 여러 건이면 만든 순서대로.
export function groupMealsBySlot(meals) {
  const map = new Map();
  for (const m of meals) {
    const key = `${m.date}|${m.slot}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  for (const rows of map.values()) {
    rows.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id));
  }
  return map;
}

// { total, count(기록 수), paid(돈 쓴 끼니), home(돈 안 쓴 끼니) }
export function sumMeals(meals) {
  let total = 0;
  let paid = 0;
  for (const m of meals) {
    const a = mealAmount(m);
    total += a;
    if (a > 0) paid++;
  }
  return { total, count: meals.length, paid, home: meals.length - paid };
}

// Map<date, 그날 합계>
export function sumMealsByDate(meals) {
  const map = new Map();
  for (const m of meals) map.set(m.date, (map.get(m.date) ?? 0) + mealAmount(m));
  return map;
}

// 카테고리별 { id, name, total, count }. 큰 순, 같으면 기록 많은 순.
export function sumMealsByCategory(meals, categories) {
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  const totals = new Map();
  for (const m of meals) {
    const key = m.category_id ?? null;
    const cur = totals.get(key) ?? { total: 0, count: 0 };
    cur.total += mealAmount(m);
    cur.count += 1;
    totals.set(key, cur);
  }
  return [...totals.entries()]
    .map(([id, v]) => ({ id, name: id === null ? '기타' : (nameOf.get(id) ?? '기타'), ...v }))
    .sort((a, b) => b.total - a.total || b.count - a.count);
}

// 저장할 때 두 표에 무엇을 쓸지 정한다. DB·DOM 을 모른다.
// before: { id, transaction_id, tx } | null,  input: { date, slot, menu, bought, categoryId, amount }
// link: 'new'(새 거래 id 를 넣는다) | 'null'(연결을 끊는다) | 'keep'(그대로)
export function planMealSave(before, input, { categoryId, memo }) {
  const amount = Math.max(0, Math.trunc(input.amount || 0));
  const txId = before?.transaction_id ?? null;
  const patch = {
    date: input.date,
    slot: input.slot,
    menu: input.menu.trim(),
    bought: input.bought.trim(),
    category_id: input.categoryId ?? null,
  };

  let tx;
  let link;
  if (amount > 0 && txId) {
    tx = { op: 'update', id: txId, payload: { kind: 'expense', amount, category_id: categoryId, date: input.date, memo } };
    link = 'keep';
  } else if (amount > 0) {
    tx = { op: 'insert', payload: { kind: 'expense', amount, category_id: categoryId, date: input.date, memo } };
    link = 'new';
  } else if (txId) {
    tx = { op: 'delete', id: txId };
    link = 'null';
  } else {
    tx = { op: 'none' };
    link = 'null';
  }

  return {
    tx,
    meal: before ? { op: 'update', id: before.id, patch, link } : { op: 'insert', patch, link },
  };
}

// 지울 때는 거래를 먼저 지운다 (가계부에 고아가 남지 않게).
export function planMealDelete(before) {
  return {
    tx: before?.transaction_id ? { op: 'delete', id: before.transaction_id } : { op: 'none' },
    meal: { op: 'delete', id: before.id },
  };
}
