// js/calc.js 순수 함수 검증. 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthRange, shiftMonth, monthLabel, summarize, sumByCategory,
  groupByDate, formatWon, parseWon, dueLabel, sortTodos,
  calendarGrid, groupEventsByDate, formatTime, spanRange, rangeLabel, monthsBetween, sumByMonth, shiftDay, nextOccurrence,
  dayName, dayLabel, weekStart, weekDays, weekLabel, slotOfHour, resolveMealCategoryId,
  cleanLines, dropEmptyFee, howNeedsShop, howHasFee,
  buyTotal, buyAmount, mealAmount, mealSpent, sortMealBuys, mealBuyMemo, buyItemTexts, tagColor,
  groupMealsBySlot, sumMeals, sumMealsByDate, sumMealsByHow, planMealSave, planMealDelete,
  pantryLine, pantryChoices, pantryOptionLabel, usedPantryIds, groupPantryByHow, pantryStats,
  pantryShare, pantryUnitPrice,
  pantryUsedLabel, pantryNext, pantryLineShare, pantryLeftOf,
  parseOrderText, guessOrderHow, guessOrderDate, unspace,
  visitedStats, dayDiff, tripNights, tripLabel, tripStatus, sortTrips, tripsByRegion,
  nextTripName, tripDates, groupPlansByDate, splitPrep, sumPlans, sumCosts, groupPacking,
} from '../js/calc.js';

test('monthRange: 해당 월 1일과 말일', () => {
  assert.deepEqual(monthRange(2026, 9), { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(monthRange(2026, 2), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(monthRange(2028, 2), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(monthRange(2026, 12), { start: '2026-12-01', end: '2026-12-31' });
});

test('shiftMonth: 연도 넘김', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 5, 0), { year: 2026, month: 5 });
});

test('monthLabel', () => {
  assert.equal(monthLabel(2026, 9), '2026년 9월');
});

const txs = [
  { id: 1, kind: 'expense', amount: 12000, category_id: 1, date: '2026-09-03', created_at: '2026-09-03T10:00:00Z' },
  { id: 2, kind: 'expense', amount: 8000,  category_id: 1, date: '2026-09-03', created_at: '2026-09-03T12:00:00Z' },
  { id: 3, kind: 'expense', amount: 5000,  category_id: null, date: '2026-09-01', created_at: '2026-09-01T09:00:00Z' },
  { id: 4, kind: 'income',  amount: 3000000, category_id: 9, date: '2026-09-25', created_at: '2026-09-25T09:00:00Z' },
  { id: 5, kind: 'expense', amount: 30000, category_id: 2, date: '2026-09-10', created_at: '2026-09-10T09:00:00Z' },
];
const cats = [
  { id: 1, name: '식비', kind: 'expense' },
  { id: 2, name: '교통', kind: 'expense' },
  { id: 9, name: '월급', kind: 'income' },
];

test('summarize: 수입·지출·남은 돈', () => {
  assert.deepEqual(summarize(txs), { income: 3000000, expense: 55000, balance: 2945000 });
  assert.deepEqual(summarize([]), { income: 0, expense: 0, balance: 0 });
});

test('sumByCategory: 지출만, 큰 순, 미분류 포함', () => {
  assert.deepEqual(sumByCategory(txs, cats), [
    { id: 2, name: '교통', total: 30000 },
    { id: 1, name: '식비', total: 20000 },
    { id: null, name: '미분류', total: 5000 },
  ]);
});

test('groupByDate: 날짜 내림차순, 같은 날은 최신 먼저', () => {
  const g = groupByDate(txs);
  assert.deepEqual(g.map(x => x.date), ['2026-09-25', '2026-09-10', '2026-09-03', '2026-09-01']);
  assert.deepEqual(g[2].items.map(x => x.id), [2, 1]);
});

test('formatWon / parseWon', () => {
  assert.equal(formatWon(0), '0');
  assert.equal(formatWon(1234567), '1,234,567');
  assert.equal(parseWon('1,234,567'), 1234567);
  assert.equal(parseWon('12abc'), 12);
  assert.equal(parseWon(''), 0);
});

test('dueLabel: 지남/오늘/내일/날짜', () => {
  const today = '2026-09-05';
  assert.equal(dueLabel(null, today), null);
  assert.deepEqual(dueLabel('2026-09-03', today), { text: '2일 지남', overdue: true });
  assert.deepEqual(dueLabel('2026-09-05', today), { text: '오늘', overdue: false });
  assert.deepEqual(dueLabel('2026-09-06', today), { text: '내일', overdue: false });
  assert.deepEqual(dueLabel('2026-10-01', today), { text: '10월 1일', overdue: false });
});

test('sortTodos: 마감 있는 것 먼저, 완료는 최신순', () => {
  const todos = [
    { id: 1, done: false, due: null,         created_at: '2026-09-01T00:00:00Z' },
    { id: 2, done: false, due: '2026-09-10', created_at: '2026-09-02T00:00:00Z' },
    { id: 3, done: true,  due: null,         created_at: '2026-09-01T00:00:00Z', done_at: '2026-09-03T00:00:00Z' },
    { id: 4, done: false, due: '2026-09-07', created_at: '2026-09-03T00:00:00Z' },
    { id: 5, done: false, due: null,         created_at: '2026-08-30T00:00:00Z' },
    { id: 6, done: true,  due: null,         created_at: '2026-09-01T00:00:00Z', done_at: '2026-09-04T00:00:00Z' },
  ];
  const { open, done } = sortTodos(todos);
  assert.deepEqual(open.map(t => t.id), [4, 2, 5, 1]);
  assert.deepEqual(done.map(t => t.id), [6, 3]);
});

test('calendarGrid: 42칸, 일요일 시작, 이번 달 표시', () => {
  const g = calendarGrid(2026, 9); // 2026-09-01 은 화요일
  assert.equal(g.length, 42);
  assert.equal(g[0].date, '2026-08-30');
  assert.equal(g[0].inMonth, false);
  assert.equal(g[2].date, '2026-09-01');
  assert.equal(g[2].inMonth, true);
  assert.equal(g[31].date, '2026-09-30');
  assert.equal(g[32].inMonth, false);
  assert.equal(g.filter(c => c.inMonth).length, 30);
});

test('groupEventsByDate: 종일 먼저, 시간순', () => {
  const ev = [
    { id: 1, date: '2026-09-05', time: '14:00:00', created_at: '1' },
    { id: 2, date: '2026-09-05', time: null,       created_at: '2' },
    { id: 3, date: '2026-09-05', time: '09:30:00', created_at: '3' },
    { id: 4, date: '2026-09-06', time: null,       created_at: '4' },
  ];
  const m = groupEventsByDate(ev);
  assert.deepEqual(m.get('2026-09-05').map(e => e.id), [2, 3, 1]);
  assert.deepEqual(m.get('2026-09-06').map(e => e.id), [4]);
  assert.equal(m.get('2026-09-07'), undefined);
});

test('formatTime', () => {
  assert.equal(formatTime('14:30:00'), '14:30');
  assert.equal(formatTime('09:05'), '09:05');
  assert.equal(formatTime(null), '종일');
});

test('spanRange: 끝 달 기준 N개월', () => {
  assert.deepEqual(spanRange(2026, 9, 1), { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(spanRange(2026, 9, 3), { start: '2026-07-01', end: '2026-09-30' });
  assert.deepEqual(spanRange(2026, 2, 12), { start: '2025-03-01', end: '2026-02-28' });
});

test('rangeLabel', () => {
  assert.equal(rangeLabel('2026-09-01', '2026-09-30'), '2026년 9월');
  assert.equal(rangeLabel('2026-07-01', '2026-09-30'), '2026년 7월 ~ 9월');
  assert.equal(rangeLabel('2025-10-01', '2026-09-30'), '2025년 10월 ~ 2026년 9월');
  assert.equal(rangeLabel('2026-07-01', '2026-09-15', true), '2026.07.01 ~ 2026.09.15');
});

test('monthsBetween', () => {
  assert.deepEqual(monthsBetween('2026-07-01', '2026-09-30'), ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(monthsBetween('2025-11-15', '2026-01-03'), ['2025-11', '2025-12', '2026-01']);
  assert.deepEqual(monthsBetween('2026-09-01', '2026-09-30'), ['2026-09']);
});

test('sumByMonth: 빈 달은 0', () => {
  const t = [
    { kind: 'expense', amount: 100, date: '2026-07-03' },
    { kind: 'expense', amount: 250, date: '2026-09-10' },
    { kind: 'income',  amount: 900, date: '2026-09-25' },
  ];
  assert.deepEqual(sumByMonth(t, '2026-07-01', '2026-09-30'), [
    { ym: '2026-07', expense: 100, income: 0 },
    { ym: '2026-08', expense: 0, income: 0 },
    { ym: '2026-09', expense: 250, income: 900 },
  ]);
});

test('shiftDay: 월·연 넘김', () => {
  assert.equal(shiftDay('2026-09-30', 1), '2026-10-01');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
});

test('nextOccurrence: 반복 기념일', () => {
  const t = '2026-09-05';
  assert.deepEqual(nextOccurrence('2023-05-20', t, true), { date: '2027-05-20', days: 257, years: 4, together: 1205 });
  assert.deepEqual(nextOccurrence('2023-09-05', t, true), { date: '2026-09-05', days: 0, years: 3, together: 1097 });
  assert.deepEqual(nextOccurrence('1994-10-01', t, true), { date: '2026-10-01', days: 26, years: 32, together: 11663 });
  assert.equal(nextOccurrence('2027-01-01', t, true).years, 0);
});

test('nextOccurrence: 한 번짜리', () => {
  assert.deepEqual(nextOccurrence('2026-12-24', '2026-09-05', false), { date: '2026-12-24', days: 110, years: 0, together: 0 });
  assert.equal(nextOccurrence('2026-01-01', '2026-09-05', false), null);
});

// ---- 식비(주간) ---------------------------------------------------------------
// 2026-08-31 월, 2026-09-07 월, 2026-09-08 화, 2026-09-13 일

test('dayName / dayLabel', () => {
  assert.equal(dayName('2026-09-13'), '일');
  assert.equal(dayName('2026-09-07'), '월');
  assert.equal(dayLabel('2026-09-13'), '9월 13일 (일)');
  assert.equal(dayLabel('2026-09-01'), '9월 1일 (화)');
});

test('weekStart: 월요일 시작', () => {
  assert.equal(weekStart('2026-09-07'), '2026-09-07'); // 월요일은 그대로
  assert.equal(weekStart('2026-09-08'), '2026-09-07'); // 화요일
  assert.equal(weekStart('2026-09-13'), '2026-09-07'); // 일요일은 그 주의 끝
  assert.equal(weekStart('2026-09-01'), '2026-08-31'); // 달 넘김
});

test('weekDays: 월~일 7개', () => {
  assert.deepEqual(weekDays('2026-09-07'), [
    '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13',
  ]);
  assert.equal(weekDays('2026-08-31').at(-1), '2026-09-06');
});

test('weekLabel: 같은 달 / 달·해 넘김', () => {
  assert.equal(weekLabel('2026-09-07'), '9월 7일 ~ 13일');
  assert.equal(weekLabel('2026-08-31'), '8월 31일 ~ 9월 6일');
  assert.equal(weekLabel('2026-12-28'), '12월 28일 ~ 1월 3일');
});

test('slotOfHour: 시각별 기본 끼니', () => {
  assert.equal(slotOfHour(8), 'breakfast');
  assert.equal(slotOfHour(12), 'lunch');
  assert.equal(slotOfHour(19), 'dinner');
  assert.equal(slotOfHour(23), 'night');
});

test('cleanLines: 이름·가격이 둘 다 빈 줄은 버린다', () => {
  assert.deepEqual(
    cleanLines([
      { name: ' 삼겹살 600g ', amount: '12000' },
      { name: '', amount: 0 },            // 자동으로 붙는 빈 줄
      { name: '얻어온 양파', amount: '' }, // 이름만 있으면 남긴다
      { name: '', amount: 3000 },          // 가격만 있어도 남긴다
    ]),
    [
      { name: '삼겹살 600g', amount: 12000 },
      { name: '얻어온 양파', amount: 0 },
      { name: '', amount: 3000 },
    ],
  );
  assert.deepEqual(cleanLines(null), []);
});

test('buyTotal: 품목 가격의 합', () => {
  assert.equal(buyTotal({ lines: [{ name: 'a', amount: 12000 }, { name: 'b', amount: 3000 }] }), 15000);
  assert.equal(buyTotal({ lines: [] }), 0);
});

test('buyAmount: 연결이 없거나 지출이 아니면 0', () => {
  assert.equal(buyAmount({ tx: { kind: 'expense', amount: 19000 } }), 19000);
  assert.equal(buyAmount({ tx: null }), 0);
  assert.equal(buyAmount({ tx: { kind: 'income', amount: 5000 } }), 0); // 가계부에서 수입으로 바뀐 경우
});

test('sortMealBuys: sort_order → 만든 순 → id', () => {
  const rows = [
    { id: 3, sort_order: 1, created_at: 'b' },
    { id: 1, sort_order: 0, created_at: 'a' },
    { id: 2, sort_order: 0, created_at: 'a' },
  ];
  assert.deepEqual(sortMealBuys(rows).map((r) => r.id), [1, 2, 3]);
});

test('mealBuyMemo: 빈 조각은 빼고 점으로 잇는다', () => {
  assert.equal(
    mealBuyMemo({ slot: 'dinner', menu: '김치찌개', how: '마트', lines: [{ name: '삼겹살 600g', amount: 18000 }] }),
    '저녁 · 김치찌개 · 마트 · 삼겹살 600g',
  );
  assert.equal(mealBuyMemo({ slot: 'lunch', menu: '제육덮밥', how: '배달', lines: [] }), '점심 · 제육덮밥 · 배달');
  assert.equal(mealBuyMemo({ slot: 'night', menu: '', how: '', lines: [] }), '야식');
});

test('mealBuyMemo: 메뉴가 길어도 어떻게·산 것이 살아남는다', () => {
  const memo = mealBuyMemo({
    slot: 'dinner',
    menu: '가'.repeat(100),
    how: '마트',
    lines: [{ name: '삼겹살', amount: 1000 }],
  });
  assert.ok(memo.includes('마트'), memo);
  assert.ok(memo.includes('삼겹살'), memo);
  assert.ok(memo.length <= 60);
});

test('howNeedsShop / howHasFee: 배달·포장·외식만 가게 이름, 배달만 배달료', () => {
  assert.equal(howNeedsShop('배달'), true);
  assert.equal(howNeedsShop('포장'), true);
  assert.equal(howNeedsShop('외식'), true);
  assert.equal(howNeedsShop('마트'), false);  // 카테고리 이름이 곧 가게
  assert.equal(howNeedsShop('컬리'), false);
  assert.equal(howHasFee('배달'), true);
  assert.equal(howHasFee('포장'), false);
});

test('dropEmptyFee: 값을 안 적은 배달료 칸은 버린다', () => {
  assert.deepEqual(dropEmptyFee([{ name: '김밥', amount: 5000 }, { name: '배달료', amount: 0 }]),
    [{ name: '김밥', amount: 5000 }]);
  assert.deepEqual(dropEmptyFee([{ name: '김밥', amount: 5000 }, { name: '배달료', amount: 3000 }]),
    [{ name: '김밥', amount: 5000 }, { name: '배달료', amount: 3000 }]);
});

test('mealBuyMemo: 가게 이름이 있으면 품목 대신 그걸 쓴다', () => {
  assert.equal(
    mealBuyMemo({ slot: 'lunch', menu: '짜장면', how: '배달', shop: '○○반점', lines: [{ name: '짜장면', amount: 9000 }] }),
    '점심 · 짜장면 · 배달 · ○○반점',
  );
  assert.equal(
    mealBuyMemo({ slot: 'dinner', menu: '김치찌개', how: '마트', shop: '', lines: [{ name: '삼겹살', amount: 1 }] }),
    '저녁 · 김치찌개 · 마트 · 삼겹살',
  );
});

test('buyItemTexts: 품목마다 이름과 가격을 따로', () => {
  assert.deepEqual(
    buyItemTexts([{ name: '참치', amount: 300 }, { name: '고추장', amount: 4500 }]),
    [{ name: '참치', price: '300원' }, { name: '고추장', price: '4,500원' }],
  );
  assert.deepEqual(buyItemTexts([{ name: '얻어온 파', amount: 0 }]), [{ name: '얻어온 파', price: '' }]);
  assert.deepEqual(buyItemTexts([{ name: '', amount: 5000 }]), [{ name: '', price: '5,000원' }]);
  assert.deepEqual(buyItemTexts([]), []);
});

test('tagColor: 앞 8개는 서로 다른 색, 그 뒤로는 돌려 쓴다', () => {
  const eight = [0, 1, 2, 3, 4, 5, 6, 7].map(tagColor);
  assert.equal(new Set(eight).size, 8);
  assert.equal(tagColor(8), tagColor(0));
  assert.equal(tagColor(-1), tagColor(7)); // 목록에 없는 카테고리(-1)도 색이 나온다
});

const meals = [
  {
    id: 1, date: '2026-09-07', slot: 'dinner', menu: '김치찌개', eater: null, place_id: 51,
    buys: [
      { id: 11, how_id: 70, lines: [{ name: '삼겹살 600g', amount: 18000 }], transaction_id: 91,
        tx: { id: 91, kind: 'expense', amount: 18000, date: '2026-09-07', category_id: 1, memo: '저녁 · 김치찌개 · 마트 · 삼겹살 600g' } },
      { id: 12, how_id: 10, lines: [{ name: '두부', amount: 7000 }], transaction_id: 92,
        tx: { id: 92, kind: 'expense', amount: 7000, date: '2026-09-07', category_id: 1, memo: '저녁 · 김치찌개 · 컬리 · 두부' } },
    ],
  },
  { id: 2, date: '2026-09-07', slot: 'lunch', menu: '구내식당', eater: 'u1', place_id: 52, buys: [] },
  {
    id: 3, date: '2026-09-08', slot: 'lunch', menu: '김밥', eater: null, place_id: 53,
    buys: [{ id: 13, how_id: 40, lines: [{ name: '', amount: 5000 }], transaction_id: 93,
             tx: { id: 93, kind: 'income', amount: 5000 } }], // 가계부에서 수입으로 바뀐 경우
  },
];
const mealCats = [
  { id: 1, name: '식비', kind: 'expense' },
  { id: 10, name: '컬리', kind: 'meal_how' },
  { id: 40, name: '배달', kind: 'meal_how' },
  { id: 70, name: '마트', kind: 'meal_how' },
  { id: 51, name: '집', kind: 'meal_where' },
];

test('mealAmount: 한 끼의 세트 금액을 모두 더한다', () => {
  assert.equal(mealAmount(meals[0]), 25000);
  assert.equal(mealAmount(meals[1]), 0);
  assert.equal(mealAmount(meals[2]), 0); // 수입으로 바뀐 거래는 안 센다
});

test('sumMeals: 끼니 수·세트 수·돈 쓴 끼니를 함께 센다', () => {
  // 합계는 '먹은 값어치'(줄에 적힌 값) 다. 가계부에서 수입으로 바뀌었든 말든
  // 그 끼니에 먹은 것은 그대로다 — 가계부 금액은 mealAmount 가 따로 본다.
  assert.deepEqual(sumMeals(meals), { total: 30000, count: 3, paid: 2, free: 1, buys: 3 });
  assert.deepEqual(sumMeals([]), { total: 0, count: 0, paid: 0, free: 0, buys: 0 });
});

test('sumMealsByDate: 날짜별 합계', () => {
  const by = sumMealsByDate(meals);
  assert.equal(by.get('2026-09-07'), 25000);
  assert.equal(by.get('2026-09-08'), 5000);
});

test('sumMealsByHow: 어떻게별 합계, 큰 순', () => {
  assert.deepEqual(sumMealsByHow(meals, mealCats), [
    { id: 70, name: '마트', total: 18000, count: 1 },
    { id: 10, name: '컬리', total: 7000, count: 1 },
    { id: 40, name: '배달', total: 5000, count: 1 },
  ]);
});

test('groupMealsBySlot: 같은 끼니 여러 건은 만든 순', () => {
  const rows = [
    { id: 2, date: '2026-09-07', slot: 'lunch', created_at: 'b' },
    { id: 1, date: '2026-09-07', slot: 'lunch', created_at: 'a' },
    { id: 3, date: '2026-09-07', slot: 'dinner', created_at: 'c' },
  ];
  const g = groupMealsBySlot(rows);
  assert.deepEqual(g.get('2026-09-07|lunch').map((m) => m.id), [1, 2]);
  assert.equal(g.get('2026-09-07|breakfast'), undefined);
});

test('resolveMealCategoryId: 연결된 거래의 분류를 유지한다', () => {
  assert.equal(resolveMealCategoryId(mealCats, { category_id: 9 }), 9); // 가계부에서 바꾼 분류를 되돌리지 않는다
  assert.equal(resolveMealCategoryId(mealCats, null), 1);               // 없으면 '식비'
  assert.equal(resolveMealCategoryId([], null), null);                  // '식비' 가 없으면 미분류
});

// ---- 사 둔 것 -----------------------------------------------------------------
// 담을 때는 가계부에 안 들어가고, 꺼내 쓴 개수만큼 그 끼니가 나눠 낸다.
// (옛 방식으로 이미 전가를 낸 품목 — charged_buy_id 가 있는 것 — 은 그대로 둔다.)

const pantry = [
  { id: 1, how_id: 10, name: '삼겹살 600g', amount: 12000, bought_on: '2026-09-07', charged_buy_id: null, done: false },
  { id: 2, how_id: 10, name: '두부', amount: 3000, bought_on: '2026-09-09', charged_buy_id: 91, done: false },
  { id: 3, how_id: 10, name: '우유', amount: 2500, bought_on: '2026-09-09', charged_buy_id: 91, done: true },
  { id: 4, how_id: 70, name: '양파 한 망', amount: 5000, bought_on: '2026-09-08', charged_buy_id: null, done: false },
];

test('pantryLine: 끼니에 꺼내 왔으면 한 개 먹은 것으로 시작한다', () => {
  // 꺼내 놓고 버튼을 따로 누르지 않아도 먹은 것으로 잡힌다 (안 먹었으면 '안 씀' 으로 되돌린다).
  assert.deepEqual(pantryLine(pantry[0]), { name: '삼겹살 600g', amount: 12000, pantry_id: 1, used: 1 });
  assert.deepEqual(pantryLine({ id: 5, name: '즉석밥', amount: 55900, qty: 4 }),
    { name: '즉석밥', amount: 13975, pantry_id: 5, used: 1 });
});

test('사 둔 것에서 꺼낸 줄은 가계부로 안 가고, 식비 합계에는 들어간다', () => {
  const four = { id: 5, how_id: 10, name: '즉석밥', amount: 55900, qty: 4, left_qty: 4, done: false };
  const line = { ...pantryLine(four), used: 1, amount: pantryShare(four, { used: 1 }) };
  assert.equal(line.amount, 13975);

  const p = planMealSave(null, {
    ...base,
    buys: [{ id: null, howId: 10, lines: [line, { name: '콜라', amount: 2000 }] }],
  }, mealCats);
  // 가계부로 가는 것은 사 둔 것이 아닌 줄만
  assert.equal(p.buys[0].tx.payload.amount, 2000);
  // 세트에는 두 줄 다 남는다
  assert.deepEqual(p.buys[0].patch.lines.map((l) => l.amount), [13975, 2000]);

  // 식비 탭이 보여 주는 값에는 사 둔 것 몫도 들어간다
  const meal = { buys: [{ lines: [line, { name: '콜라', amount: 2000 }], tx: { kind: 'expense', amount: 2000 } }] };
  assert.equal(mealAmount(meal), 2000);   // 가계부에 실제로 잡힌 돈
  assert.equal(mealSpent(meal), 15975);   // 그 끼니에 먹은 값어치
});

test('pantryUnitPrice: 개당 얼마', () => {
  assert.equal(pantryUnitPrice({ amount: 10000, qty: 4 }), 2500);
  assert.equal(pantryUnitPrice({ amount: 10000, qty: 3 }), 3333);
  assert.equal(pantryUnitPrice({ amount: 12000 }), 12000); // 개수가 없으면 한 개짜리
});

test('pantryShare: 쓴 개수만큼 나누고, 다 쓰면 합이 산 값과 같다', () => {
  const four = { amount: 10000, qty: 4 };
  assert.equal(pantryShare(four, { before: 0, used: 0 }), 0);      // 남김이면 안 낸다
  assert.equal(pantryShare(four, { before: 0, used: 1 }), 2500);
  assert.equal(pantryShare(four, { before: 2, used: 2 }), 5000);   // 뒤쪽 두 개
  assert.equal(pantryShare(four, { before: 0, used: 9 }), 10000);  // 넘겨 적어도 전가까지

  // 나누어떨어지지 않으면 마지막 한 개가 잔돈을 가져간다.
  const three = { amount: 10000, qty: 3 };
  const parts = [0, 1, 2].map((before) => pantryShare(three, { before, used: 1 }));
  assert.deepEqual(parts, [3333, 3333, 3334]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 10000);
});

test('pantryUsedLabel / pantryNext: 한 개짜리는 다 씀 → 남김 → 안 씀, 여러 개면 세어 간다', () => {
  assert.equal(pantryUsedLabel(0, 1), '안 씀');
  assert.equal(pantryUsedLabel(1, 1), '다 씀');
  assert.equal(pantryUsedLabel(1, 3), '1개 씀');
  assert.equal(pantryUsedLabel(2, 3), '2개 씀');
  assert.equal(pantryUsedLabel(3, 3), '다 씀');
  assert.equal(pantryUsedLabel(9, 3), '다 씀'); // 넘겨 적어도 다 씀
  assert.equal(pantryUsedLabel(0, 1, true), '남김');   // 먹긴 했는데 남았다
  assert.equal(pantryUsedLabel(0, 3, true), '남김');
  assert.equal(pantryUsedLabel(1, 1, true), '다 씀');   // 다 먹었으면 남김은 의미 없다

  // 한 개짜리: 꺼내 오면 다 씀 → 남김 → 안 씀 → 다 씀
  const one = [{ used: 1, part: false }];
  for (let k = 0; k < 3; k++) one.push(pantryNext(one.at(-1), 1));
  assert.deepEqual(one, [
    { used: 1, part: false }, { used: 0, part: true }, { used: 0, part: false }, { used: 1, part: false },
  ]);
  // 여러 개면 예전 그대로 개수만 돈다 (남김은 안 끼어든다)
  assert.deepEqual([0, 1, 2, 3].map((used) => pantryNext({ used }, 3).used), [1, 2, 3, 0]);
  assert.deepEqual([0, 1, 2, 3].map((used) => pantryNext({ used }, 3).part), [false, false, false, false]);
  assert.deepEqual(pantryNext(undefined, 1), { used: 1, part: false });
});

test('pantryLineShare: 한 개짜리 남김도 값이 들어가고, 마저 먹는 끼니는 또 안 낸다', () => {
  const snack = { amount: 1500, qty: 1 };
  assert.equal(pantryLineShare(snack, { part: true }), 1500);                    // 뜯어서 조금 먹음
  assert.equal(pantryLineShare(snack, { used: 1, othersPart: 1 }), 0);           // 남은 걸 마저 먹음
  assert.equal(pantryLineShare(snack, { part: true, othersPart: 1 }), 0);        // 또 조금 먹고 또 남김
  assert.equal(pantryLineShare(snack, { used: 1 }), 1500);                       // 한 번에 다 먹음
  assert.equal(pantryLineShare(snack, {}), 0);                                   // 안 씀
  // 여러 개짜리는 예전과 같다 (4개에 10,000원, 다른 끼니가 1개 먹음 → 이번에 2개)
  assert.equal(pantryLineShare({ amount: 10000, qty: 4 }, { used: 2, othersUsed: 1 }), 5000);
});

test('pantryLeftOf: 남은 개수 (예전에 담은 것은 다 씀 여부로 본다)', () => {
  assert.equal(pantryLeftOf({ qty: 3, left_qty: 2 }), 2);
  assert.equal(pantryLeftOf({ qty: 3, left_qty: 9 }), 3);   // 산 것보다 많이 남을 수는 없다
  assert.equal(pantryLeftOf({ qty: 3, left_qty: -1 }), 0);
  assert.equal(pantryLeftOf({ qty: 3, done: false }), 3);   // left_qty 가 없던 시절
  assert.equal(pantryLeftOf({ qty: 3, done: true }), 0);
  assert.equal(pantryLeftOf({}), 1);
});

test('pantryChoices: 다 쓴 것·다른 카테고리·이미 고른 것은 빼고 최근 것부터', () => {
  assert.deepEqual(pantryChoices(pantry, { howId: 10 }).map((c) => c.id), [2, 1]); // 3번은 다 씀, 4번은 마트
  assert.deepEqual(pantryChoices(pantry, { howId: 10, usedIds: [2] }).map((c) => c.id), [1]);
  assert.deepEqual(pantryChoices(pantry, { howId: 70 }).map((c) => c.id), [4]);
  assert.deepEqual(pantryChoices(pantry, { howId: 99 }), []);
  assert.deepEqual(pantryChoices(null, { howId: 10 }), []);
});

test('pantryOptionLabel: 한 개짜리는 값, 여러 개면 개당 값과 남은 개수', () => {
  assert.equal(pantryOptionLabel(pantry[0]), '삼겹살 600g · 12,000원');
  assert.equal(pantryOptionLabel(pantry[1]), '두부 · 3,000원');
  assert.equal(pantryOptionLabel({ name: '즉석밥', amount: 55900, qty: 4, left_qty: 3 }),
    '즉석밥 · 개당 13,975원 · 3개 남음');
});

test('usedPantryIds: 지금 고치는 끼니가 이미 쓰고 있는 품목', () => {
  const sets = [
    { lines: [{ name: '삼겹살 600g', amount: 12000, pantry_id: 1 }, { name: '소금', amount: 1000 }] },
    { lines: [{ name: '두부', amount: 0, pantry_id: 2 }] },
  ];
  assert.deepEqual(usedPantryIds(sets), [1, 2]);
  assert.deepEqual(usedPantryIds([]), []);
  assert.deepEqual(usedPantryIds(null), []);
});

test('cleanLines: 사 둔 것 꼬리표는 지키고, 직접 적은 줄은 두 칸 그대로', () => {
  assert.deepEqual(
    cleanLines([
      { name: '삼겹살 600g', amount: 12000, pantry_id: '1', used: 2 },
      { name: '소금', amount: 1000 },
      { name: '두부', amount: 0, pantry_id: 2 },
      { name: '비엔나', amount: 0, pantry_id: 3, done: true },   // 예전 줄: '다 씀' = 한 개 썼다
      { name: '과자', amount: 1500, pantry_id: 5, used: 0, part: true },  // 남김
      { name: '소금', amount: 1000, part: true },                          // 직접 적은 줄엔 안 붙는다
      { name: '김', amount: 0, pantry_id: 6, used: 1, part: true },       // 다 먹었으면 남김은 떨어진다
    ]),
    [
      { name: '삼겹살 600g', amount: 12000, pantry_id: 1, used: 2 },
      { name: '소금', amount: 1000 },
      { name: '두부', amount: 0, pantry_id: 2, used: 0 },
      { name: '비엔나', amount: 0, pantry_id: 3, used: 1 },
      { name: '과자', amount: 1500, pantry_id: 5, used: 0, part: true },
      { name: '소금', amount: 1000 },
      { name: '김', amount: 0, pantry_id: 6, used: 1 },
    ],
  );
});

test('buyItemTexts: 값이 없는 줄은 가격 자리에 안 씀/개수/다 씀', () => {
  const qtyOf = (id) => (id === 4 ? 3 : 1); // 4번만 세 개짜리
  assert.deepEqual(
    buyItemTexts([
      { name: '삼겹살 600g', amount: 12000, pantry_id: 1, used: 0 }, // 값이 실린 줄은 가격 그대로
      { name: '두부', amount: 0, pantry_id: 2, used: 1 },
      { name: '콩나물', amount: 0, pantry_id: 3, used: 0 },
      { name: '비엔나', amount: 0, pantry_id: 4, used: 2 },
      { name: '얻어온 파', amount: 0 },                               // 직접 적은 줄은 예전 그대로 빈칸
      { name: '과자', amount: 0, pantry_id: 5, used: 0, part: true }, // 남이 뜯어 둔 걸 또 남김
    ], qtyOf),
    [
      { name: '삼겹살 600g', price: '12,000원' },
      { name: '두부', price: '다 씀' },
      { name: '콩나물', price: '안 씀' },
      { name: '비엔나', price: '2개 씀' },
      { name: '얻어온 파', price: '' },
      { name: '과자', price: '남김' },
    ],
  );
});

test('groupPantryByHow: 칩 순서대로 묶고 최근에 산 것부터', () => {
  const groups = groupPantryByHow(pantry, mealCats);
  assert.deepEqual(groups.map((g) => g.name), ['컬리', '마트']);
  assert.deepEqual(groups[0].items.map((i) => i.id), [3, 2, 1]); // 9/9 두 개 → id 큰 것 먼저, 그 다음 9/7
  assert.equal(groups[0].total, 17500);
  assert.deepEqual(groupPantryByHow([{ id: 9, how_id: null, name: '어디선가', amount: 0 }], mealCats)[0].name, '기타');
});

test('pantryStats: 남은 개수와 아직 안 먹고 남은 값어치', () => {
  // 돈은 살 때 이미 냈다. leftValue 는 '앞으로 나갈 돈' 이 아니라 냉장고에 남은 값어치다.
  assert.deepEqual(pantryStats(pantry), { left: 3, units: 3, done: 1, leftValue: 20000 });
  // 3개에 9,000원 중 하나를 먹었으면 6,000원어치가 남는다
  assert.deepEqual(pantryStats([{ qty: 3, left_qty: 2, done: false, amount: 9000 }]),
    { left: 1, units: 2, done: 0, leftValue: 6000 });
  assert.deepEqual(pantryStats([]), { left: 0, units: 0, done: 0, leftValue: 0 });
  assert.equal(pantryOptionLabel({ name: '과자', amount: 1500, qty: 1, part_count: 1 }), '과자 · 먹다 남김');
  // 먹다 남긴 과자: 한 개 남아 있지만 값어치는 이미 그 끼니에 들어갔다
  assert.deepEqual(pantryStats([{ qty: 1, left_qty: 1, done: false, amount: 1500, part_count: 1 }]),
    { left: 1, units: 1, done: 0, leftValue: 0 });
});

test('planMealSave: 사 둔 것만 든 세트는 거래를 만들지 않는다', () => {
  const four = { id: 5, how_id: 10, name: '즉석밥', amount: 10000, qty: 4, left_qty: 4, done: false };
  const p = planMealSave(null, {
    ...base,
    buys: [
      { id: null, howId: 10, lines: [{ ...pantryLine(four), used: 1, amount: pantryShare(four, { used: 1 }) }] },
    ],
  }, mealCats);
  assert.deepEqual(p.buys[0].tx, { op: 'none', id: null }); // 돈은 장 본 날 이미 나갔다
  assert.equal(p.buys[0].patch.lines[0].amount, 2500);      // 먹은 값어치는 그대로 실려 간다
  assert.equal(p.buys[0].patch.lines[0].used, 1);
});

// ---- planMealSave -------------------------------------------------------------

const base = { date: '2026-09-07', slot: 'dinner', menu: '김치찌개', eater: null, placeId: 51 };

test('planMealSave: 세트 0개면 거래를 만들지 않는다', () => {
  const p = planMealSave(null, { ...base, buys: [] }, mealCats);
  assert.equal(p.meal.id, null);
  assert.deepEqual(p.buys, []);
  assert.deepEqual(p.removed, []);
  assert.deepEqual(p.meal.patch, { date: '2026-09-07', slot: 'dinner', menu: '김치찌개', eater: null, place_id: 51 });
});

test('planMealSave: 세트 2개면 거래 2건을 insert 한다', () => {
  const p = planMealSave(null, {
    ...base,
    buys: [
      { id: null, howId: 70, lines: [{ name: '삼겹살', amount: 12000 }, { name: '양파', amount: 3000 }] },
      { id: null, howId: 10, lines: [{ name: '두부', amount: 7000 }] },
    ],
  }, mealCats);
  assert.equal(p.buys.length, 2);
  assert.deepEqual(p.buys.map((b) => b.tx.op), ['insert', 'insert']);
  assert.equal(p.buys[0].tx.payload.amount, 15000); // 품목 가격의 합
  assert.equal(p.buys[1].tx.payload.amount, 7000);
  assert.equal(p.buys[0].tx.payload.category_id, 1); // 가계부 분류는 '식비'
  assert.notEqual(p.buys[0].tx.payload.memo, p.buys[1].tx.payload.memo); // 서로 구별된다
  assert.deepEqual(p.buys.map((b) => b.patch.sort_order), [0, 1]);
});

test('planMealSave: 안 바뀐 세트에는 update 를 보내지 않는다', () => {
  const p = planMealSave(meals[0], {
    ...base,
    buys: [
      { id: 11, howId: 70, lines: [{ name: '삼겹살 600g', amount: 18000 }] },
      { id: 12, howId: 10, lines: [{ name: '두부', amount: 9000 }] }, // 이것만 고침
    ],
  }, mealCats);
  assert.equal(p.buys[0].tx.op, 'none');
  assert.equal(p.buys[1].tx.op, 'update');
  assert.equal(p.buys[1].tx.payload.amount, 9000);
});

test('planMealSave: 가격을 비우면 거래는 지우고 세트는 남는다', () => {
  const p = planMealSave(meals[0], {
    ...base,
    buys: [
      { id: 11, howId: 70, lines: [{ name: '삼겹살 600g', amount: 0 }] }, // 이름만 남김
      { id: 12, howId: 10, lines: [{ name: '두부', amount: 7000 }] },
    ],
  }, mealCats);
  assert.deepEqual(p.buys[0].tx, { op: 'delete', id: 91 });
  assert.equal(p.buys[0].id, 11);       // 세트는 살아 있다
  assert.deepEqual(p.removed, []);
});

test('planMealSave: 품목을 전부 비운 세트는 removed 에 담긴다', () => {
  const p = planMealSave(meals[0], {
    ...base,
    buys: [{ id: 12, howId: 10, lines: [{ name: '두부', amount: 7000 }] }],
  }, mealCats);
  assert.equal(p.buys.length, 1);
  assert.deepEqual(p.removed, [11]);
});

test('planMealSave: 날짜를 바꾸면 모든 거래의 date 가 따라간다', () => {
  const p = planMealSave(meals[0], {
    ...base,
    date: '2026-09-10',
    buys: [
      { id: 11, howId: 70, lines: [{ name: '삼겹살 600g', amount: 18000 }] },
      { id: 12, howId: 10, lines: [{ name: '두부', amount: 7000 }] },
    ],
  }, mealCats);
  assert.deepEqual(p.buys.map((b) => b.tx.op), ['update', 'update']);
  assert.deepEqual(p.buys.map((b) => b.tx.payload.date), ['2026-09-10', '2026-09-10']);
  assert.equal(p.meal.patch.date, '2026-09-10');
});

test('planMealSave: 끼니를 바꾸면 모든 memo 를 다시 쓴다', () => {
  const p = planMealSave(meals[0], {
    ...base,
    slot: 'lunch',
    buys: [
      { id: 11, howId: 70, lines: [{ name: '삼겹살 600g', amount: 18000 }] },
      { id: 12, howId: 10, lines: [{ name: '두부', amount: 7000 }] },
    ],
  }, mealCats);
  assert.ok(p.buys.every((b) => b.tx.op === 'update' && b.tx.payload.memo.startsWith('점심 · ')));
});

test('planMealSave: 가계부 분류는 세트마다 따로 유지한다', () => {
  const before = {
    id: 1,
    buys: [
      { id: 11, how_id: 70, transaction_id: 91, tx: { id: 91, kind: 'expense', amount: 1, date: 'x', category_id: 7, memo: 'x' } },
      { id: 12, how_id: 10, transaction_id: 92, tx: { id: 92, kind: 'expense', amount: 1, date: 'x', category_id: null, memo: 'x' } },
    ],
  };
  const p = planMealSave(before, {
    ...base,
    buys: [
      { id: 11, howId: 70, lines: [{ name: 'a', amount: 100 }] },
      { id: 12, howId: 10, lines: [{ name: 'b', amount: 200 }] },
    ],
  }, mealCats);
  assert.equal(p.buys[0].tx.payload.category_id, 7);    // 가계부에서 바꾼 분류 유지
  assert.equal(p.buys[1].tx.payload.category_id, null); // 미분류였으면 미분류 유지
});

test('planMealSave: 가게 이름과 배달료를 담는다', () => {
  const p = planMealSave(null, {
    ...base,
    buys: [{ id: null, howId: 64, shop: ' ○○반점 ', lines: [{ name: '짜장면', amount: 9000 }, { name: '배달료', amount: 3000 }] }],
  }, [...mealCats, { id: 64, name: '배달', kind: 'meal_how' }]);
  assert.equal(p.buys[0].patch.shop, '○○반점');          // 앞뒤 공백 제거
  assert.equal(p.buys[0].tx.payload.amount, 12000);        // 배달료까지 합계에 들어간다
  assert.equal(p.buys[0].tx.payload.memo, '저녁 · 김치찌개 · 배달 · ○○반점');
});

test('planMealSave: 값 없는 배달료 칸만 있으면 저장하지 않는다', () => {
  const p = planMealSave(null, {
    ...base,
    buys: [{ id: null, howId: 64, shop: '', lines: [{ name: '배달료', amount: 0 }] }],
  }, mealCats);
  assert.deepEqual(p.buys, []);
});

test('planMealSave: 가게 이름만 적어도 세트를 남긴다', () => {
  const p = planMealSave(null, {
    ...base,
    buys: [{ id: null, howId: 64, shop: '○○반점', lines: [] }],
  }, mealCats);
  assert.equal(p.buys.length, 1);
  assert.equal(p.buys[0].tx.op, 'none'); // 금액이 없으니 거래는 안 만든다
});

test('planMealSave: 빈 세트는 저장 계획에서 빠진다', () => {
  const p = planMealSave(null, {
    ...base,
    buys: [
      { id: null, howId: 70, lines: [] },                              // ＋ 눌렀다가 그만둔 세트
      { id: null, howId: 10, lines: [{ name: '두부', amount: 7000 }] },
    ],
  }, mealCats);
  assert.equal(p.buys.length, 1);
  assert.equal(p.buys[0].patch.how_id, 10);
});

test('planMealDelete: 끼니 id 와 함께 지워질 거래를 알려 준다', () => {
  assert.deepEqual(planMealDelete(meals[0]), { mealId: 1, txIds: [91, 92] });
  assert.deepEqual(planMealDelete(meals[1]), { mealId: 2, txIds: [] });
});

// ---- 주문 스크린샷 읽기 ---------------------------------------------------------
// 아래 글은 실제 컬리 주문 내역 화면을 한글 Tesseract 로 읽은 결과 그대로다
// (200g→2009, 오징어짬뽕→오징어짱 처럼 틀리게 읽힌 것도 손대지 않았다).
const KURLY_OCR = `주문 내역 상세
2026.09.09 22:45
주문번호 2426922450272
충북 청주시 청원구 오창읍 과학산업3로 216 (오창반도유보라퍼스티지) 104동 2301호
주문 상품
배송완료 9.10(목) 05:11
별배송
[사조대림] 육식맨의 케제크라이너
4,480원             1개
별배송
[사조대림] 육식맨의 리얼 비엔나
4,480원             1개
별배송
[제각각] 청상추 2009
3,940원             1개
별배송
[크라운] 산도 살구팝 3239
5,380원 1
별배송
[농심] 오징어짱 5입
5,300원 1
배송 조회
반품 접수
후기 작성
전체 상품 다시 담기
결제 정보
상품금액 33,600원
배송비 0원
할인금액 -3,000원
결제금액 30,600원`;

test('parseOrderText: 컬리 주문 화면에서 품목과 낸 값을 뽑는다', () => {
  assert.deepEqual(parseOrderText(KURLY_OCR), [
    { name: '[사조대림] 육식맨의 케제크라이너', amount: 4480 },
    { name: '[사조대림] 육식맨의 리얼 비엔나', amount: 4480 },
    { name: '[제각각] 청상추 2009', amount: 3940 },
    { name: '[크라운] 산도 살구팝 3239', amount: 5380 },
    { name: '[농심] 오징어짱 5입', amount: 5300 },
  ]);
});

test('parseOrderText: 배송·주문·결제 줄은 품목이 되지 않는다', () => {
  const names = parseOrderText(KURLY_OCR).map((i) => i.name).join(' ');
  for (const bad of ['배송', '주문', '결제', '상품금액', '할인', '청주시']) {
    assert.ok(!names.includes(bad), `${bad} 가 품목으로 들어갔다: ${names}`);
  }
  // 맨 아래 결제 요약(33,600 / 30,600) 도 품목이 아니다
  assert.ok(!parseOrderText(KURLY_OCR).some((i) => i.amount === 30600 || i.amount === 33600));
});

test('parseOrderText: 할인 상품은 취소선 그은 값 말고 낸 값을 쓴다', () => {
  assert.deepEqual(parseOrderText('[사조대림] 케제크라이너\n4,480원 4,980원 | 1개'),
    [{ name: '[사조대림] 케제크라이너', amount: 4480 }]);
});

test('parseOrderText: 쉼표가 마침표로 읽혀도 값은 같다 (작은 스크린샷)', () => {
  assert.deepEqual(parseOrderText('[크라운] 산도 살구팝\n5.380원'), [{ name: '[크라운] 산도 살구팝', amount: 5380 }]);
});

test('parseOrderText: 여러 개 산 것은 개수 칸으로 간다', () => {
  assert.deepEqual(parseOrderText('유기농 콩나물 300g\n4,400원 | 2개'),
    [{ name: '유기농 콩나물 300g', amount: 4400, qty: 2 }]);
  // 한 개면 개수를 붙이지 않는다 (기본이 1개다)
  assert.deepEqual(parseOrderText('두부\n3,000원 | 1개'), [{ name: '두부', amount: 3000 }]);
});

test('parseOrderText: 수량이 틀리게 읽혀도 그 품목을 안 놓친다', () => {
  // 실제로 '1개' 가 '17!' · '기' · '1 개' 로 읽힌 적이 있다. 그 줄을 가격 줄로 못 알아보면
  // 바로 위 품목이 통째로 빠진다 (컬리 화면에서 마지막 두 줄이 그렇게 사라졌다).
  assert.deepEqual(parseOrderText('[농심] 신라면 골드 4입\n5,980원 17!'),
    [{ name: '[농심] 신라면 골드 4입', amount: 5980 }]);
  assert.deepEqual(parseOrderText('[크라운] 산도 살구팝\n5,380원 기'),
    [{ name: '[크라운] 산도 살구팝', amount: 5380 }]);
  assert.deepEqual(parseOrderText('두부 한 모\n3,000원'),
    [{ name: '두부 한 모', amount: 3000 }]);
});

test('parseOrderText: 한글이 여럿 남는 줄은 가격 줄이 아니다', () => {
  // '상품금액 39,650원' 을 가격 줄로 보면 바로 위 줄이 품목으로 딸려 들어간다.
  assert.deepEqual(parseOrderText('[농심] 신라면\n5,980원 1개\n상품금액 39,650원\n결제금액 36,650원'),
    [{ name: '[농심] 신라면', amount: 5980 }]);
  // 값이 섞인 줄은 이름으로 안 쓴다 — 안 그러면 못 걸러 낸 요약 줄이 품목으로 들어온다.
  // 그래서 '5,000원권 상품권' 같은 이름은 못 잡는다(드물고, 시트에서 적으면 된다).
  assert.deepEqual(parseOrderText('5,000원권 상품권 세트\n4,500원 1개'), []);
});

test('unspace: 한 글자씩 떼어 놓인 줄만 붙인다', () => {
  // 옛 학습 데이터가 이렇게 뱉었다. 띄어쓰기가 통째로 가짜라 붙이는 게 낫다.
  assert.equal(unspace('[ 사 조 대 림 ] 육 식 맨 의 케 제 크 라 이 너'), '[사조대림]육식맨의케제크라이너');
  assert.equal(unspace('떼 각 각 ] 청 상 추 20009'), '떼각각]청상추20009');
  // 멀쩡한 줄은 그대로 둔다
  assert.equal(unspace('[사조대림] 육식맨의 케제크라이너'), '[사조대림] 육식맨의 케제크라이너');
  assert.equal(unspace('[크라운] 산도 살구팝 323g'), '[크라운] 산도 살구팝 323g');
  assert.equal(unspace('4,480원 1개'), '4,480원 1개');
  assert.equal(unspace('두부 한 모'), '두부 한 모');   // 짧은 줄은 손대지 않는다
  assert.equal(unspace(''), '');
  assert.equal(unspace(null), '');
});

test('parseOrderText: 글자가 벌어져 있어도 품목을 잡는다', () => {
  const spaced = `배 송 완 료 9.10(목) 05:11
[ 사 조 대 림 ] 육 식 맨 의 케 제 크 라 이 너
4,480 원 1 개
떼 각 각 ] 청 상 추 20009
3,940 원 1 개`;
  assert.deepEqual(parseOrderText(spaced), [
    { name: '[사조대림]육식맨의케제크라이너', amount: 4480 },
    { name: '떼각각]청상추20009', amount: 3940 },
  ]);
});

test('parseOrderText: 가격 줄이 없으면 아무것도 안 담는다', () => {
  assert.deepEqual(parseOrderText('그냥 메모\n아무것도 아님'), []);
  assert.deepEqual(parseOrderText(''), []);
  assert.deepEqual(parseOrderText(null), []);
});

test('guessOrderHow: 이름이 보일 때만 짐작하고, 아니면 사람이 고르게 둔다', () => {
  // 컬리 주문 화면에는 정작 '컬리' 라는 글자가 없을 때가 많다 (상품 이름에 우연히 들어갈 뿐).
  // 그래서 못 찾는 것이 정상이고, 그때는 시트에서 고른 칩을 그대로 쓴다.
  assert.equal(guessOrderHow(KURLY_OCR, mealCats), null);
  assert.equal(guessOrderHow(`${KURLY_OCR}\n[컬리멤버스] 데일리 물티슈`, mealCats), 10);
  assert.equal(guessOrderHow('Kurly 주문 내역', mealCats), 10);
  assert.equal(guessOrderHow('쿠팡 주문 내역', [...mealCats, { id: 20, name: '쿠팡', kind: 'meal_how' }]), 20);
  assert.equal(guessOrderHow('아무 글', mealCats), null);
  assert.equal(guessOrderHow(KURLY_OCR, null), null);
});

test('guessOrderDate: 주문 날짜를 읽는다', () => {
  assert.equal(guessOrderDate(KURLY_OCR), '2026-09-09');
  assert.equal(guessOrderDate('2026-09-09 22:45'), '2026-09-09');
  assert.equal(guessOrderDate('2026. 9. 9'), '2026-09-09');
  assert.equal(guessOrderDate('2026.19.09'), null); // 달이 19월일 수는 없다
  assert.equal(guessOrderDate('날짜 없음'), null);
});

// ---- 여행 ------------------------------------------------------------------

const regions = [
  { c: '11010', n: '종로구', s: '서울' },
  { c: '11020', n: '중구', s: '서울' },
  { c: '39010', n: '제주시', s: '제주' },
  { c: '39020', n: '서귀포시', s: '제주' },
  { c: '32030', n: '강릉시', s: '강원' },
];

test('visitedStats: 전체 수와 비율', () => {
  const s = visitedStats(regions, new Set(['11010', '39010']));
  assert.equal(s.done, 2);
  assert.equal(s.total, 5);
  assert.equal(s.percent, 40);
});

test('visitedStats: 하나도 안 갔을 때', () => {
  const s = visitedStats(regions, new Set());
  assert.deepEqual([s.done, s.percent], [0, 0]);
  assert.equal(s.sido.every((x) => x.done === 0), true);
});

test('visitedStats: 시도별 집계와 순서', () => {
  const s = visitedStats(regions, new Set(['39010', '39020', '32030']), ['서울', '강원', '제주']);
  assert.deepEqual(s.sido, [
    { name: '서울', done: 0, total: 2 },
    { name: '강원', done: 1, total: 1 },
    { name: '제주', done: 2, total: 2 },
  ]);
});

test('visitedStats: 지도에 없는 코드는 세지 않는다', () => {
  const s = visitedStats(regions, new Set(['11010', '99999']));
  assert.equal(s.done, 1);
});

test('visitedStats: 지역이 없으면 0%', () => {
  assert.deepEqual(visitedStats([], new Set(['11010'])), { done: 0, total: 0, percent: 0, sido: [] });
});

// ---- 여행 계획 --------------------------------------------------------------

test('dayDiff: 날짜 사이 일수', () => {
  assert.equal(dayDiff('2026-10-03', '2026-10-05'), 2);
  assert.equal(dayDiff('2026-10-03', '2026-10-03'), 0);
  assert.equal(dayDiff('2026-12-30', '2027-01-02'), 3);
  assert.equal(dayDiff('2026-10-05', '2026-10-03'), -2);
});

test('tripNights: 박/일', () => {
  assert.deepEqual(tripNights('2026-10-03', '2026-10-05'), { nights: 2, days: 3 });
  assert.deepEqual(tripNights('2026-10-03', '2026-10-03'), { nights: 0, days: 1 });
});

test('tripLabel: 기간 표시', () => {
  assert.equal(tripLabel('2026-10-03', '2026-10-05'), '2026년 10월 3일 ~ 5일 · 2박 3일');
  assert.equal(tripLabel('2026-10-30', '2026-11-02'), '2026년 10월 30일 ~ 11월 2일 · 3박 4일');
  assert.equal(tripLabel('2026-12-30', '2027-01-02'), '2026년 12월 30일 ~ 2027년 1월 2일 · 3박 4일');
  assert.equal(tripLabel('2026-10-03', '2026-10-03'), '2026년 10월 3일 · 당일치기');
});

test('tripStatus: 다가오는 여행', () => {
  const t = { start_date: '2026-10-03', end_date: '2026-10-05' };
  assert.deepEqual(tripStatus(t, '2026-09-21'), { state: 'upcoming', days: 12, text: 'D-12' });
  assert.deepEqual(tripStatus(t, '2026-10-02'), { state: 'upcoming', days: 1, text: 'D-1' });
});

test('tripStatus: 여행 중 (시작·끝 당일 포함)', () => {
  const t = { start_date: '2026-10-03', end_date: '2026-10-05' };
  assert.equal(tripStatus(t, '2026-10-03').text, '여행 중 · 1일째');
  assert.equal(tripStatus(t, '2026-10-05').text, '여행 중 · 3일째');
  assert.equal(tripStatus(t, '2026-10-04').state, 'ongoing');
});

test('tripStatus: 지난 여행', () => {
  const t = { start_date: '2026-10-03', end_date: '2026-10-05' };
  assert.deepEqual(tripStatus(t, '2026-10-06'), { state: 'past', days: 1, text: '어제' });
  assert.equal(tripStatus(t, '2026-10-15').text, '10일 전');
});

const trips = [
  { id: 1, title: '지난 제주', start_date: '2026-05-01', end_date: '2026-05-03', regions: [{ code: '39010' }, { code: '39020' }] },
  { id: 2, title: '이번 강릉', start_date: '2026-09-12', end_date: '2026-09-14', regions: [{ code: '32030' }] },
  { id: 3, title: '가을 경주', start_date: '2026-10-03', end_date: '2026-10-05', regions: [{ code: '37020' }] },
  { id: 4, title: '작년 제주', start_date: '2025-05-01', end_date: '2025-05-03', regions: [{ code: '39010' }] },
];

test('sortTrips: 다가오는 여행은 가까운 순, 지난 여행은 최근 순', () => {
  const { upcoming, past } = sortTrips(trips, '2026-09-13'); // 강릉은 여행 중
  assert.deepEqual(upcoming.map((t) => t.id), [2, 3]);
  assert.deepEqual(past.map((t) => t.id), [1, 4]);
});

test('sortTrips: 끝난 날 당일은 아직 지난 여행이 아니다', () => {
  const { upcoming, past } = sortTrips([trips[1]], '2026-09-14');
  assert.equal(upcoming.length, 1);
  assert.equal(past.length, 0);
});

test('tripsByRegion: 지역별로 묶고 최근 순', () => {
  const map = tripsByRegion(trips);
  assert.deepEqual(map.get('39010').map((t) => t.id), [1, 4]);
  assert.deepEqual(map.get('39020').map((t) => t.id), [1]);
  assert.equal(map.has('11010'), false);
});

test('tripsByRegion: 지역이 없는 여행은 건너뛴다', () => {
  assert.equal(tripsByRegion([{ id: 9, start_date: '2026-01-01' }]).size, 0);
});

test('nextTripName: 이름을 안 적으면 어디로 짓는다', () => {
  assert.equal(nextTripName('제주시', 0), '제주시');
  assert.equal(nextTripName('제주시', 2), '제주시 3');
  assert.equal(nextTripName(' 강릉시 ', 1), '강릉시 2');
  assert.equal(nextTripName('', 3), '여행');
  assert.equal(nextTripName(null), '여행');
});

test('tripDates: 기간의 날짜들', () => {
  assert.deepEqual(tripDates('2026-09-13', '2026-09-15'), ['2026-09-13', '2026-09-14', '2026-09-15']);
  assert.deepEqual(tripDates('2026-09-13', '2026-09-13'), ['2026-09-13']);
  assert.deepEqual(tripDates('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01']);
});

const plans = [
  { id: 1, date: '2026-09-14', place: '성산일출봉', created_at: '2026-09-14T01:00:00Z',
    costs: [{ id: 1, amount: 5000 }, { id: 2, amount: 12000 }] },       // 티켓 + 굿즈
  { id: 2, date: '2026-09-13', place: '공항', costs: [], created_at: '2026-09-13T01:00:00Z' },
  { id: 3, date: '2026-09-13', place: '점심', costs: [{ id: 3, amount: 24000 }], created_at: '2026-09-13T02:00:00Z' },
  { id: 4, date: '2026-10-01', place: '기간 밖', costs: [{ id: 4, amount: 1000 }], created_at: '2026-09-13T00:30:00Z' },
];

test('groupPlansByDate: 일차별로 묶고 적은 순서대로', () => {
  const map = groupPlansByDate(plans, tripDates('2026-09-13', '2026-09-15'));
  assert.deepEqual([...map.keys()], ['2026-09-13', '2026-09-14', '2026-09-15']);
  assert.deepEqual(map.get('2026-09-13').map((p) => p.id), [4, 2, 3]); // 기간 밖은 첫날로
  assert.deepEqual(map.get('2026-09-14').map((p) => p.id), [1]);
  assert.deepEqual(map.get('2026-09-15'), []);
});

test('splitPrep: 미리 결제한 것은 일차에서 빼 둔다', () => {
  const list = [
    { id: 5, date: '2026-08-20', prep: true, place: '항공권', created_at: '2026-08-20T00:00:00Z' },
    ...plans,
    { id: 6, date: '2026-07-01', prep: true, place: '숙소', created_at: '2026-07-01T00:00:00Z' },
  ];
  const { prep, rest } = splitPrep(list);
  assert.deepEqual(prep.map((p) => p.id), [6, 5]);            // 결제일 순
  assert.deepEqual(rest.map((p) => p.id), [1, 2, 3, 4]);      // 나머지는 그대로
  // 준비를 빼고 묶어야 기간 밖 날짜가 1일째로 끌려 들어가지 않는다
  const map = groupPlansByDate(rest, tripDates('2026-09-13', '2026-09-15'));
  assert.deepEqual(map.get('2026-09-13').map((p) => p.id), [4, 2, 3]);
  assert.deepEqual(splitPrep([]), { prep: [], rest: [] });
});

test('sumCosts: 한 장소에 붙은 지출 줄들', () => {
  assert.equal(sumCosts(plans[0]), 17000);   // 티켓 5,000 + 굿즈 12,000
  assert.equal(sumCosts(plans[1]), 0);       // 돈 안 쓴 장소
  assert.equal(sumCosts({}), 0);
  assert.equal(sumCosts(null), 0);
});

test('sumPlans: 쓴 돈 합계', () => {
  assert.equal(sumPlans(plans), 42000);
  assert.equal(sumPlans([]), 0);
});

test('groupPacking: 기본 분류 순서 → 새 분류는 이름 순', () => {
  const items = [
    { id: 1, title: '충전기', group_name: '전자기기', sort_order: 30 },
    { id: 2, title: '속옷', group_name: '의류', sort_order: 20 },
    { id: 3, title: '상의', group_name: '의류', sort_order: 10 },
    { id: 4, title: '여권', group_name: '서류', sort_order: 40 },
    { id: 5, title: '수영복', group_name: '해변', sort_order: 50 },
    { id: 6, title: '무엇', sort_order: 60 },
  ];
  const groups = groupPacking(items, ['의류', '세면도구', '전자기기', '서류', '기타']);
  assert.deepEqual(groups.map((g) => g.name), ['의류', '전자기기', '서류', '기타', '해변']);
  assert.deepEqual(groups[0].items.map((i) => i.title), ['상의', '속옷']); // sort_order 순
  assert.deepEqual(groups[3].items.map((i) => i.title), ['무엇']);        // 분류 없으면 기타
});

test('groupPacking: 비어 있으면 빈 목록', () => {
  assert.deepEqual(groupPacking([], ['의류']), []);
});
