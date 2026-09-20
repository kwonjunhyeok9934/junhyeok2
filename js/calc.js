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
// 사 둔 것에서 꺼낸 줄만 pantry_id·used 를 더 달고 다닌다 (직접 적은 줄은 예전 그대로 두 칸).
export function cleanLines(lines) {
  return (lines ?? [])
    .map((l) => {
      const out = {
        name: String(l?.name ?? '').trim(),
        amount: Math.max(0, Math.trunc(Number(l?.amount) || 0)),
      };
      const id = Math.trunc(Number(l?.pantry_id) || 0);
      if (id > 0) {
        out.pantry_id = id;
        // 이 끼니에서 몇 개를 끝냈나. 예전 줄은 done 만 있었다 — '다 씀' 은 한 개 쓴 것으로 읽는다.
        out.used = l?.used === undefined
          ? (l?.done === true ? 1 : 0)
          : Math.max(0, Math.trunc(Number(l.used) || 0));
      }
      return out;
    })
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

// 식비 탭이 보여 주는 값. 사 둔 것에서 꺼낸 몫까지 더한다.
// 그 돈은 장 본 날 이미 가계부로 갔지만, **먹은 것은 이 끼니**다. 그래서
// 식비 합계(이번 주에 얼마어치 먹었나)와 가계부 합계(언제 얼마를 썼나)는 서로 다르다.
export function mealSpent(meal) {
  return (meal?.buys ?? []).reduce((a, b) => a + buyTotal(b), 0);
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

// 세트의 품목을 한 줄씩. 이름과 가격을 따로 줘서 화면에서 가격 열을 맞출 수 있게 한다.
// [{ name: '참치', price: '300원' }, { name: '고추장', price: '4,500원' }]
// 값이 안 실린 사 둔 것 줄은 가격 자리에 '남김'/'2개'/'다 씀' 이 들어간다 —
// 열을 하나 더 두면 모든 줄에서 폭을 뺏어 품목 이름이 잘린다.
// qtyOf(pantry_id) 로 그 품목을 몇 개 샀는지 알려 주면 '다 씀' 까지 가려 준다.
export function buyItemTexts(lines, qtyOf = () => 1) {
  return cleanLines(lines).map((l) => ({
    name: l.name,
    price: l.amount
      ? `${formatWon(l.amount)}원`
      : l.pantry_id
        ? pantryUsedLabel(l.used, qtyOf(l.pantry_id))
        : '',
  }));
}

// '어떻게' 뱃지 색. 목록 순서로 돌려 쓴다 —
// 이름 해시로 하면 컬리와 마트가 같은 색으로 겹칠 수 있다(실제로 겹쳤다).
const TAG_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
export function tagColor(index) {
  return TAG_COLORS[((index % TAG_COLORS.length) + TAG_COLORS.length) % TAG_COLORS.length];
}

// { total, count(끼니 수), paid(돈 쓴 끼니), free(돈 안 쓴 끼니), buys(세트 수) }
export function sumMeals(meals) {
  let total = 0;
  let paid = 0;
  let buys = 0;
  for (const m of meals) {
    const a = mealSpent(m);
    total += a;
    buys += (m.buys ?? []).length;
    if (a > 0) paid++;
  }
  return { total, count: meals.length, paid, free: meals.length - paid, buys };
}

// Map<date, 그날 합계>
export function sumMealsByDate(meals) {
  const map = new Map();
  for (const m of meals) map.set(m.date, (map.get(m.date) ?? 0) + mealSpent(m));
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
      cur.total += buyTotal(b);
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

    // 사 둔 것에서 꺼낸 줄은 가계부로 가지 않는다. 장 볼 때 이미 낸 돈이라
    // 여기서 또 세면 같은 돈을 두 번 세게 된다. (식비 합계에는 buyTotal 로 들어간다.)
    const amount = lines.reduce((a, l) => a + (l.pantry_id ? 0 : l.amount), 0);
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

// ---- 사 둔 것(품목을 담아 두고 식비에서 꺼내 쓴다) --------------------------------
// 윙잇·컬리·쿠팡·마트·편의점에서 산 품목을 미리 담아 둔다. 담을 때는 가계부에 안 들어가고,
// **처음 꺼내 먹을 때 한 번만** 그 세트에 값이 실린다. 다음에 또 먹으면 0원 줄로 붙어
// 같은 돈을 두 번 세지 않는다. 다 먹었으면 '다 씀', 아직 남았으면 '남김'.

// 개당 얼마인지 (보여 주기용). 4개에 10,000원이면 2,500원.
export function pantryUnitPrice(item) {
  const total = Math.max(0, Math.trunc(Number(item?.amount) || 0));
  const qty = Math.max(1, Math.trunc(Number(item?.qty) || 1));
  return Math.floor(total / qty);
}

// 이 끼니가 낼 돈. 쓴 개수만큼만 낸다.
//   before = 이 끼니 앞에서 다른 끼니들이 이미 쓴 개수
//   used   = 이 끼니에서 쓴 개수
// 누적 지점끼리 빼는 방식이라, 다 쓰고 나면 조각들의 합이 정확히 전가가 된다.
// (3개에 10,000원 → 3,333 / 3,333 / 3,334 — 마지막 한 개가 잔돈을 가져간다.)
//
// 이 값은 가계부로 가지 않는다. 돈은 장 볼 때 이미 나갔다(사 둔 것을 담는 순간
// 가계부에 지출로 들어간다). 여기서는 '그 끼니에 얼마어치를 먹었나' 만 보여 준다.
export function pantryShare(item, { before = 0, used = 0 } = {}) {
  const total = Math.max(0, Math.trunc(Number(item?.amount) || 0));
  const qty = Math.max(1, Math.trunc(Number(item?.qty) || 1));
  const at = (n) => (n >= qty ? total : Math.floor((total * n) / qty));
  const b = Math.min(qty, Math.max(0, Math.trunc(Number(before) || 0)));
  const u = Math.min(qty - b, Math.max(0, Math.trunc(Number(used) || 0)));
  return at(b + u) - at(b);
}

// 사 둔 것 하나를 세트의 품목 줄로. 처음에는 '남김'(0개 끝냄) — 아직 안 썼으니 0원이다.
export function pantryLine(item) {
  return {
    name: String(item?.name ?? '').trim(),
    amount: pantryShare(item, { before: 0, used: 0 }),
    pantry_id: item?.id,
    used: 0,
  };
}

// 이 끼니에서 몇 개를 끝냈는지 보여 주는 말. 한 개짜리면 예전 그대로 남김/다 씀 이다.
export function pantryUsedLabel(used, qty = 1) {
  const n = Math.max(0, Math.trunc(Number(used) || 0));
  const total = Math.max(1, Math.trunc(Number(qty) || 1));
  if (n <= 0) return '남김';
  if (n >= total) return '다 씀';
  return `${n}개`;
}

// 버튼을 누를 때 다음 개수. 0 → 1 → … → qty → 0 으로 돈다.
export function pantryNextUsed(used, qty = 1) {
  const total = Math.max(1, Math.trunc(Number(qty) || 1));
  const n = Math.max(0, Math.trunc(Number(used) || 0));
  return n >= total ? 0 : n + 1;
}

// 드롭다운에 올릴 것: 그 카테고리에서 아직 안 끝난 품목 중 이 끼니가 아직 안 쓴 것. 최근에 산 것부터.
export function pantryChoices(items, { howId = null, usedIds = [] } = {}) {
  const used = new Set(usedIds);
  return (items ?? [])
    .filter((it) => !it.done && it.how_id === howId && !used.has(it.id))
    .map((it) => ({ ...it }))
    .sort((a, b) => (a.bought_on < b.bought_on ? 1 : a.bought_on > b.bought_on ? -1 : (b.id ?? 0) - (a.id ?? 0)));
}

// '삼겹살 600g · 12,000원' / 여러 개면 '· 개당 2,500원 · 3개 남음'
export function pantryOptionLabel(item) {
  const name = String(item?.name ?? '').trim();
  const qty = Math.max(1, Math.trunc(Number(item?.qty) || 1));
  const total = Math.max(0, Math.trunc(Number(item?.amount) || 0));
  if (qty <= 1) return `${name} · ${total ? `${formatWon(total)}원` : '값 없음'}`;
  return `${name} · 개당 ${formatWon(pantryUnitPrice(item))}원 · ${pantryLeftOf(item)}개 남음`;
}

// 남은 개수. 예전에 담은 것(left_qty 가 없는 것)은 다 씀이면 0, 아니면 qty.
export function pantryLeftOf(item) {
  const qty = Math.max(1, Math.trunc(Number(item?.qty) || 1));
  if (item?.left_qty == null) return item?.done ? 0 : qty;
  return Math.max(0, Math.min(qty, Math.trunc(Number(item.left_qty) || 0)));
}

// 지금 고치고 있는 끼니가 이미 쓰고 있는 품목들 (한 끼니에서 같은 걸 두 번 고르지 못하게).
export function usedPantryIds(sets) {
  const out = [];
  for (const s of sets ?? []) {
    for (const l of s?.lines ?? []) if (l?.pantry_id) out.push(Math.trunc(Number(l.pantry_id)));
  }
  return out;
}

// 사 둔 것 목록을 카테고리(어떻게)별로. 카테고리는 칩 순서대로, 품목은 최근에 산 것부터.
export function groupPantryByHow(items, cats) {
  const order = new Map((cats ?? []).filter((c) => c.kind === 'meal_how').map((c, i) => [c.id, i]));
  const nameOf = new Map((cats ?? []).map((c) => [c.id, c.name]));
  const groups = new Map();
  for (const it of items ?? []) {
    const key = it.how_id ?? null;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        name: key === null ? '기타' : (nameOf.get(key) ?? '기타'),
        at: order.get(key) ?? 99,
        items: [],
      });
    }
    groups.get(key).items.push(it);
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) => (a.bought_on < b.bought_on ? 1 : a.bought_on > b.bought_on ? -1 : (b.id ?? 0) - (a.id ?? 0)));
    g.total = g.items.reduce((n, it) => n + Math.max(0, Math.trunc(Number(it.amount) || 0)), 0);
  }
  return [...groups.values()].sort((a, b) => a.at - b.at || (a.id ?? 0) - (b.id ?? 0));
}

// { left: 남은 품목 줄 수, units: 남은 낱개 수, done: 다 쓴 줄 수, waiting: 아직 가계부에 안 들어간 돈 }
export function pantryStats(items) {
  let left = 0;
  let units = 0;
  let done = 0;
  let leftValue = 0;
  for (const it of items ?? []) {
    if (it.done) {
      done += 1;
      continue;
    }
    left += 1;
    const n = pantryLeftOf(it);
    units += n;
    // 아직 안 먹고 남은 값어치. 돈은 살 때 이미 냈으니 '앞으로 나갈 돈' 이 아니다.
    leftValue += pantryShare(it, { before: Math.max(1, Math.trunc(Number(it.qty) || 1)) - n, used: n });
  }
  return { left, units, done, leftValue };
}

// ---- 주문 스크린샷 읽기 ---------------------------------------------------------
// OCR 로 읽어 낸 글을 '사 둔 것' 줄로 바꾼다. 컬리·쿠팡·윙잇은 화면이 서로 다르지만
// "품목 이름 줄 → 그 아래 가격 줄" 이라는 뼈대는 같아서 그 뼈대만 본다.
// 글자는 어차피 조금 틀리게 읽히므로, 여기서 완벽을 노리지 않고 담기 시트에 채워
// 사람이 고쳐 저장하게 하는 것이 이 함수의 목적이다.

// 가격·수량·구분선만 남은 줄인지 보려고 지우는 것들.
const PRICE_RE = /(\d[\d,.]*)\s*원/g;
const PRICE_AT = /(\d[\d,.]*)\s*원/;   // 값이 줄 어디쯤에서 시작하는지 (이름과 한 줄에 있을 때)
const QTY_RE = /(\d+)\s*개/;

// 품목 이름도, 가격 줄도 될 수 없는 줄 (배송·주문·결제 안내).
const ORDER_NOISE = [
  /배송/, /주문/, /결제/, /결재/, /상품\s*금액/, /상품금액/, /합계/, /할인/, /적립/, /쿠폰/,
  /반품/, /교환/, /후기/, /영수증/, /카드/, /무이자/, /포인트/, /복사/, /적용/,
  /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/, // 2026.09.09 22:45
  /^[\d\s:().월일시분]+$/,                 // 9.10(목) 05:11 같은 줄
];

const isOrderNoise = (line) => ORDER_NOISE.some((re) => re.test(unspace(line)));

// OCR 이 한글을 한 글자씩 떼어 놓을 때가 있다 ('[ 사 조 대 림 ] 육 식 맨 의 케 제 크 라 이 너').
// 그런 줄은 띄어쓰기가 통째로 가짜라 붙여 놓는 편이 읽을 만하다.
// 멀쩡한 줄은 건드리지 않는다 — 한 글자짜리 토막이 절반을 넘을 때만 붙인다.
export function unspace(line) {
  const parts = String(line ?? '').trim().split(/\s+/);
  if (parts.length < 4) return String(line ?? '');
  const singles = parts.filter((w) => /^[가-힣]$/.test(w)).length;
  return singles / parts.length > 0.5 ? parts.join('') : String(line ?? '');
}

// 그 줄에 적힌 가격들 (큰 자릿수 쉼표가 마침표로 읽히는 일이 잦아 둘 다 받는다).
function pricesIn(line) {
  return [...String(line).matchAll(PRICE_RE)].map((m) => parseWon(m[1])).filter((n) => n > 0);
}

// 가격 말고는 수량 부스러기만 남는 줄 = 가격 줄.
// 수량은 자주 틀리게 읽힌다 ('1개' → '17!', '기', '개'). 글자 수만 보면 그런 줄을 놓치고
// 그 품목이 통째로 빠지므로, **한글이 거의 없다**는 것으로 가른다 —
// 품목 이름이나 '상품금액' 같은 줄에는 한글이 여럿 남는다.
function isPriceLine(line, prices) {
  if (!prices.length) return false;
  const rest = String(line).replace(PRICE_RE, '').replace(/[\s|,.·\-/]/g, '');
  const hangul = (rest.match(/[가-힣]/g) ?? []).length;
  return rest.length <= 4 && hangul <= 1;
}

// OCR 글 → [{ name, amount }]. 이름이 없거나 가격이 0인 것은 버린다.
export function parseOrderText(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => unspace(l.trim()))
    .filter(Boolean);

  const out = [];
  let name = '';
  const add = (nm, line, prices) => {
    // 할인 상품은 낸 값과 취소선 그은 원래 값이 같이 적힌다 — 싼 쪽이 실제로 낸 값이다.
    const qty = Math.max(1, Math.trunc(Number(QTY_RE.exec(line)?.[1]) || 1));
    const amount = Math.min(...prices);
    out.push(qty > 1 ? { name: nm, amount, qty } : { name: nm, amount });
  };

  for (const line of lines) {
    if (isOrderNoise(line)) continue;
    const prices = pricesIn(line);

    if (!prices.length) {          // 값이 없는 줄 = 품목 이름 후보
      name = line.slice(0, 40);
      continue;
    }
    if (isPriceLine(line, prices)) {   // 값만 있는 줄 = 이름은 바로 위에 있다
      if (name) {
        add(name, line, prices);
        name = '';
      }
      continue;
    }
    // 이름과 값이 한 줄에 같이 나온 경우 ('… 케제크라이너 4,480원 1개').
    // 값 앞을 이름으로 쓴다 — 안 그러면 그 품목이 통째로 사라진다.
    const head = line.slice(0, PRICE_AT.exec(line)?.index ?? 0).trim();
    if (head) {
      add(head.slice(0, 40), line, prices);
      name = '';
    }
  }
  return out;
}

// 읽은 글에서 어느 카테고리인지 짐작한다 (못 찾으면 null — 사람이 칩을 누르면 된다).
export function guessOrderHow(text, cats) {
  const hay = String(text ?? '').toLowerCase();
  const hit = (cats ?? [])
    .filter((c) => c.kind === 'meal_how')
    .find((c) => hay.includes(String(c.name).toLowerCase()));
  if (hit) return hit.id;
  if (/kurly|컬리/i.test(hay)) return (cats ?? []).find((c) => c.kind === 'meal_how' && c.name === '컬리')?.id ?? null;
  return null;
}

// 읽은 글에서 주문 날짜 (2026.09.09 / 2026-09-09 / 2026. 9. 9). 없으면 null.
export function guessOrderDate(text) {
  const m = /(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/.exec(String(text ?? ''));
  if (!m) return null;
  const [, y, mo, d] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${pad2(Number(mo))}-${pad2(Number(d))}`;
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

// 여행 이름은 안 적어도 된다 — "어디" 로 짓는다. 제주시를 두 번 갔으면 다음은 "제주시 3".
export function nextTripName(place, been = 0) {
  const name = (place ?? '').trim();
  if (!name) return '여행';
  return been > 0 ? `${name} ${been + 1}` : name;
}

// 여행 기간의 날짜들 ['2026-09-13', '2026-09-14', '2026-09-15']
export function tripDates(start, end) {
  const out = [];
  for (let d = start; d <= end && out.length < 60; d = shiftDay(d, 1)) out.push(d);
  return out;
}

// 여행 준비 / 일차. 항공권·숙소는 떠나기 전에 결제하니 날짜가 기간 밖이다 —
// 그냥 묶으면 1일째로 끌려 들어가 날짜가 거짓말이 된다. 그래서 따로 뺀다 (결제일 순).
export function splitPrep(plans) {
  const prep = plans
    .filter((p) => p.prep)
    .sort(
      (a, b) =>
        String(a.date).localeCompare(String(b.date)) ||
        String(a.created_at).localeCompare(String(b.created_at)) ||
        a.id - b.id,
    );
  return { prep, rest: plans.filter((p) => !p.prep) };
}

// 일차별로 묶는다. 날짜가 기간 밖이면 첫날에 붙여 둔다 (기간을 줄였을 때 사라지지 않게).
export function groupPlansByDate(plans, dates) {
  const map = new Map(dates.map((d) => [d, []]));
  for (const p of plans) {
    const key = map.has(p.date) ? p.date : dates[0];
    if (key !== undefined) map.get(key).push(p);
  }
  for (const list of map.values()) list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id);
  return map;
}

// 일정 한 줄에 붙은 지출 줄들의 합 (성산일출봉 = 티켓 5,000 + 굿즈 12,000)
export function sumCosts(plan) {
  return (plan?.costs ?? []).reduce((a, c) => a + (c.amount || 0), 0);
}

export function sumPlans(plans) {
  return plans.reduce((a, p) => a + sumCosts(p), 0);
}

// 준비물을 대분류로 묶는다. 기본 분류를 앞에 두고, 새로 만든 분류는 그 뒤에 이름 순.
// [{ name: '의류', items: [...] }, …]
export function groupPacking(items, baseOrder = []) {
  const map = new Map();
  for (const it of items) {
    const key = it.group_name || '기타';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  const rank = new Map(baseOrder.map((n, i) => [n, i]));
  const big = baseOrder.length + 100;
  return [...map.entries()]
    .map(([name, list]) => ({ name, items: list.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id) }))
    .sort((a, b) => (rank.get(a.name) ?? big) - (rank.get(b.name) ?? big) || a.name.localeCompare(b.name));
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
