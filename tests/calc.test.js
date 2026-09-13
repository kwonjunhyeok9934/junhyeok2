// js/calc.js 순수 함수 검증. 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthRange, shiftMonth, monthLabel, summarize, sumByCategory,
  groupByDate, formatWon, parseWon, dueLabel, sortTodos,
  calendarGrid, groupEventsByDate, formatTime, spanRange, rangeLabel, monthsBetween, sumByMonth, shiftDay, nextOccurrence,
  dayName, dayLabel, weekStart, weekDays, weekLabel, slotOfHour, resolveMealCategoryId,
  cleanLines, dropEmptyFee, howNeedsShop, howHasFee,
  buyTotal, buyAmount, mealAmount, sortMealBuys, mealBuyMemo, buyLineText,
  groupMealsBySlot, sumMeals, sumMealsByDate, sumMealsByHow, planMealSave, planMealDelete,
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

test('buyLineText: 품목과 가격을 이어 붙인다', () => {
  assert.equal(
    buyLineText([{ name: '고추', amount: 1500 }, { name: '양파', amount: 1000 }]),
    '고추 1,500원, 양파 1,000원',
  );
  assert.equal(buyLineText([{ name: '얻어온 파', amount: 0 }]), '얻어온 파'); // 가격이 없으면 이름만
  assert.equal(buyLineText([{ name: '', amount: 5000 }]), '5,000원');        // 이름이 없으면 가격만
  assert.equal(buyLineText([]), '');
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
  assert.deepEqual(sumMeals(meals), { total: 25000, count: 3, paid: 1, free: 2, buys: 3 });
  assert.deepEqual(sumMeals([]), { total: 0, count: 0, paid: 0, free: 0, buys: 0 });
});

test('sumMealsByDate: 날짜별 합계', () => {
  const by = sumMealsByDate(meals);
  assert.equal(by.get('2026-09-07'), 25000);
  assert.equal(by.get('2026-09-08'), 0);
});

test('sumMealsByHow: 어떻게별 합계, 큰 순', () => {
  assert.deepEqual(sumMealsByHow(meals, mealCats), [
    { id: 70, name: '마트', total: 18000, count: 1 },
    { id: 10, name: '컬리', total: 7000, count: 1 },
    { id: 40, name: '배달', total: 0, count: 1 },
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
