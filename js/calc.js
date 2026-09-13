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
// 한 끼(meal) = 날짜·끼니·메뉴·누가·어디서 하나씩.
// 세트(buy) = '어떻게 + 품목들' 하나. 한 끼에 0개도, 여러 개도 된다.
// 품목 가격이 원본이고 가계부 거래에는 세트 합계가 들어간다. 세트 하나 : 거래 하나.

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'night'];

// 컬리·쿠팡·마트·편의점은 카테고리 이름이 곧 가게다. 이 셋만 갈 때마다 가게가 다르다.
export const HOW_NEEDS_SHOP = ['배달', '포장', '외식'];
// 배달만 배달료 칸을 품목 맨 밑에 기본으로 둔다.
export const HOW_HAS_FEE = ['배달'];
export const FEE_LABEL = '배달료';

export const howNeedsShop = (name) => HOW_NEEDS_SHOP.includes(String(name ?? '').trim());
export const howHasFee = (name) => HOW_HAS_FEE.includes(String(name ?? '').trim());

// 저장할 품목 줄. 값이 안 적힌 배달료 칸은 버린다 (기본으로 놓인 빈 칸이라).
export function dropEmptyFee(lines) {
  return (lines ?? []).filter((l) => !(String(l?.name ?? '').trim() === FEE_LABEL && !Number(l?.amount)));
}
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

// 품목 줄 정리: 이름·가격이 둘 다 빈 줄은 버리고 금액은 0 이상 정수로.
export function cleanLines(lines) {
  return (lines ?? [])
    .map((l) => ({
      name: String(l?.name ?? '').trim(),
      amount: Math.max(0, Math.trunc(Number(l?.amount) || 0)),
    }))
    .filter((l) => l.name || l.amount > 0);
}

// 세트에 적힌 품목 가격의 합 = 식비 탭이 원본으로 삼는 값.
export function buyTotal(buy) {
  return cleanLines(buy?.lines).reduce((a, l) => a + l.amount, 0);
}

// 실제로 가계부에 잡혀 있는 금액. 연결이 끊겼거나 수입으로 바뀌었으면 0.
export function buyAmount(buy) {
  return buy?.tx && buy.tx.kind === 'expense' ? buy.tx.amount : 0;
}

export function mealAmount(meal) {
  return (meal?.buys ?? []).reduce((a, b) => a + buyAmount(b), 0);
}

// 'date|slot' 로 묶는다. 같은 칸에 기록이 여럿이면(둘이 따로 먹은 날) 만든 순서대로.
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

// 임베드로 딸려 온 배열은 순서가 보장되지 않는다.
export function sortMealBuys(buys) {
  return (buys ?? []).slice().sort(
    (a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) ||
      (a.id ?? 0) - (b.id ?? 0),
  );
}

const cut = (str, n) => (str.length > n ? str.slice(0, n) : str);

// 가계부에 남길 메모. 조각마다 먼저 자르고 합친다 —
// 합친 뒤에 자르면 긴 메뉴가 세트를 구별하는 꼬리(어떻게·산 것)를 다 먹는다.
// 가게 이름이 있으면 품목 목록보다 그쪽이 그 지출을 더 잘 알려 준다.
export function mealBuyMemo({ slot, menu, how, shop, lines }) {
  const tail = String(shop ?? '').trim() || cleanLines(lines).map((l) => l.name).filter(Boolean).join(', ');
  return [SLOT_LABEL[slot] ?? '', cut(String(menu ?? '').trim(), 24), String(how ?? '').trim(), cut(tail, 20)]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 60);
}

// 세트 한 줄의 품목 문구. '고추 1,500원, 양파 1,000원'
export function buyLineText(lines) {
  return cleanLines(lines)
    .map((l) => [l.name, l.amount ? `${formatWon(l.amount)}원` : ''].filter(Boolean).join(' '))
    .join(', ');
}

// { total, count(끼니 수), paid(돈 쓴 끼니), free(돈 안 쓴 끼니), buys(세트 수) }
export function sumMeals(meals) {
  let total = 0;
  let paid = 0;
  let buys = 0;
  for (const m of meals) {
    const a = mealAmount(m);
    total += a;
    buys += (m.buys ?? []).length;
    if (a > 0) paid++;
  }
  return { total, count: meals.length, paid, free: meals.length - paid, buys };
}

// Map<date, 그날 합계>
export function sumMealsByDate(meals) {
  const map = new Map();
  for (const m of meals) map.set(m.date, (map.get(m.date) ?? 0) + mealAmount(m));
  return map;
}

// '어떻게' 별 { id, name, total, count }. 큰 순, 같으면 건수 많은 순.
export function sumMealsByHow(meals, categories) {
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  const totals = new Map();
  for (const m of meals) {
    for (const b of m.buys ?? []) {
      const key = b.how_id ?? null;
      const cur = totals.get(key) ?? { total: 0, count: 0 };
      cur.total += buyAmount(b);
      cur.count += 1;
      totals.set(key, cur);
    }
  }
  return [...totals.entries()]
    .map(([id, v]) => ({ id, name: id === null ? '기타' : (nameOf.get(id) ?? '기타'), ...v }))
    .sort((a, b) => b.total - a.total || b.count - a.count);
}

// 가계부에 넣을 분류. 이미 연결된 거래가 있으면 그 분류를 유지한다
// (가계부에서 사람이 바꿔 놓은 것을 식비 탭이 되돌리지 않는다).
export function resolveMealCategoryId(cats, editingTx) {
  if (editingTx) return editingTx.category_id ?? null;
  return cats.find((c) => c.kind === 'expense' && c.name === '식비')?.id ?? null;
}

// 이미 연결된 거래가 새 payload 와 완전히 같은지. 같으면 update 를 보내지 않는다.
function sameTx(tx, payload) {
  return (
    !!tx &&
    tx.kind === 'expense' &&
    tx.amount === payload.amount &&
    (tx.category_id ?? null) === (payload.category_id ?? null) &&
    tx.date === payload.date &&
    tx.memo === payload.memo
  );
}

// 저장할 때 무엇을 쓸지 정한다. DB·DOM 을 모른다.
// before: { id, buys: [{ id, how_id, lines, transaction_id, tx }] } | null
// input:  { date, slot, menu, eater, placeId, buys: [{ id, howId, transactionId, lines }] }
// 반환값이 그대로 sb.rpc('save_meal', { p }) 의 인자가 된다.
export function planMealSave(before, input, cats) {
  const howName = new Map(cats.map((c) => [c.id, c.name]));
  const wasById = new Map((before?.buys ?? []).map((b) => [b.id, b]));
  const kept = new Set();
  const buys = [];

  (input.buys ?? []).forEach((raw, i) => {
    const lines = cleanLines(dropEmptyFee(raw.lines));
    const shop = String(raw.shop ?? '').trim();
    if (!lines.length && !shop) return; // 아무것도 안 적은 세트는 저장하지 않는다
    const was = raw.id != null ? wasById.get(raw.id) : null;
    if (was) kept.add(was.id);

    const amount = lines.reduce((a, l) => a + l.amount, 0);
    const payload = {
      amount,
      category_id: resolveMealCategoryId(cats, was?.tx ?? null),
      date: input.date,
      memo: mealBuyMemo({ slot: input.slot, menu: input.menu, how: howName.get(raw.howId) ?? '', shop, lines }),
    };
    const txId = was?.transaction_id ?? raw.transactionId ?? null;

    let tx;
    if (amount > 0 && txId) tx = sameTx(was?.tx, payload) ? { op: 'none', id: txId } : { op: 'update', id: txId, payload };
    else if (amount > 0) tx = { op: 'insert', id: null, payload };
    else if (txId) tx = { op: 'delete', id: txId }; // 값이 0이 됐으면 거래만 지우고 세트는 남긴다
    else tx = { op: 'none', id: null };

    buys.push({ id: raw.id ?? null, patch: { how_id: raw.howId ?? null, shop, lines, sort_order: i }, tx });
  });

  return {
    meal: {
      id: before?.id ?? null,
      patch: {
        date: input.date,
        slot: input.slot,
        menu: String(input.menu ?? '').trim(),
        eater: input.eater ?? null,
        place_id: input.placeId ?? null,
      },
    },
    buys,
    removed: (before?.buys ?? []).map((b) => b.id).filter((id) => !kept.has(id)),
  };
}

// 끼니를 지우면 cascade + 트리거가 세트와 거래까지 지운다. txIds 는 확인 문구용.
export function planMealDelete(before) {
  return {
    mealId: before.id,
    txIds: (before?.buys ?? []).map((b) => b.transaction_id).filter((id) => id != null),
  };
}

// ---- 여행 ------------------------------------------------------------------

// 다녀온 곳 집계: 전체 수와 시도별 { name, done, total }.
// regions: [{ c, n, s }] (지도 데이터),  visited: 다녀온 코드 Set
export function visitedStats(regions, visited, order = []) {
  const bySido = new Map();
  let done = 0;
  for (const r of regions) {
    const cur = bySido.get(r.s) ?? { name: r.s, done: 0, total: 0 };
    cur.total += 1;
    if (visited.has(r.c)) {
      cur.done += 1;
      done += 1;
    }
    bySido.set(r.s, cur);
  }
  const rank = new Map(order.map((n, i) => [n, i]));
  const sido = [...bySido.values()].sort(
    (a, b) => (rank.get(a.name) ?? 99) - (rank.get(b.name) ?? 99) || a.name.localeCompare(b.name),
  );
  const total = regions.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0, sido };
}

// ---- 여행 계획 --------------------------------------------------------------

// 두 날짜 사이 일수 (b - a). 같은 날이면 0.
export function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86400000);
}

// { nights: 2, days: 3 }
export function tripNights(start, end) {
  const nights = Math.max(0, dayDiff(start, end));
  return { nights, days: nights + 1 };
}

// "10월 3일 ~ 5일 · 2박 3일" (해가 넘어가면 연도까지)
export function tripLabel(start, end) {
  const { nights, days } = tripNights(start, end);
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  const from = `${y1}년 ${m1}월 ${d1}일`;
  const to = y1 !== y2 ? `${y2}년 ${m2}월 ${d2}일` : m1 !== m2 ? `${m2}월 ${d2}일` : `${d2}일`;
  if (nights === 0) return `${from} · 당일치기`;
  return `${from} ~ ${to} · ${nights}박 ${days}일`;
}

// 오늘 기준 상태. upcoming(D-12) · ongoing(2일째) · past(3일 전)
export function tripStatus(trip, today) {
  if (today < trip.start_date) {
    const days = dayDiff(today, trip.start_date);
    return { state: 'upcoming', days, text: days === 0 ? 'D-DAY' : `D-${days}` };
  }
  if (today <= trip.end_date) {
    const nth = dayDiff(trip.start_date, today) + 1;
    return { state: 'ongoing', days: nth, text: `여행 중 · ${nth}일째` };
  }
  const days = dayDiff(trip.end_date, today);
  return { state: 'past', days, text: days === 1 ? '어제' : `${days}일 전` };
}

// 다가오는 여행(진행 중 먼저, 가까운 순) / 지난 여행(최근 순)
export function sortTrips(trips, today) {
  const upcoming = trips
    .filter((t) => t.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id - b.id);
  const past = trips
    .filter((t) => t.end_date < today)
    .sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id - a.id);
  return { upcoming, past };
}

// Map<지역코드, [여행…]>. 여행은 최근 순.
export function tripsByRegion(trips) {
  const map = new Map();
  for (const t of trips) {
    for (const r of t.regions ?? []) {
      if (!map.has(r.code)) map.set(r.code, []);
      map.get(r.code).push(t);
    }
  }
  for (const list of map.values()) list.sort((a, b) => b.start_date.localeCompare(a.start_date));
  return map;
}
