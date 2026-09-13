// js/calc.js 순수 함수 검증. 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthRange, shiftMonth, monthLabel, summarize, sumByCategory,
  groupByDate, formatWon, parseWon, dueLabel, sortTodos,
  calendarGrid, groupEventsByDate, formatTime, spanRange, rangeLabel, monthsBetween, sumByMonth, shiftDay, nextOccurrence,
  dayName, dayLabel, weekStart, weekDays, weekLabel, slotOfHour, mealMemo, resolveMealCategoryId,
  mealAmount, groupMealsBySlot, sumMeals, sumMealsByDate, sumMealsByCategory, planMealSave, planMealDelete,
  visitedStats,
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

test('mealMemo: 빈 조각은 빼고 점으로 잇는다', () => {
  assert.equal(mealMemo({ slot: 'lunch', menu: '제육덮밥', cat: '배달' }), '점심 · 제육덮밥 · 배달');
  assert.equal(mealMemo({ slot: 'dinner', menu: '', bought: '돼지고기', cat: '마트' }), '저녁 · 돼지고기 · 마트');
  assert.equal(mealMemo({ slot: 'night', menu: '', bought: '', cat: '' }), '야식');
});

test('resolveMealCategoryId: 연결된 거래의 분류를 유지한다', () => {
  assert.equal(resolveMealCategoryId(cats, { category_id: 2 }), 2);   // 가계부에서 바꾼 분류를 되돌리지 않는다
  assert.equal(resolveMealCategoryId(cats, null), 1);                 // 없으면 '식비'
  assert.equal(resolveMealCategoryId([], null), null);                // '식비' 가 없으면 미분류
});

const meals = [
  { id: 1, date: '2026-09-07', slot: 'lunch', menu: '제육덮밥', category_id: 21, created_at: '2026-09-07T04:00:00Z', transaction_id: 91, tx: { id: 91, kind: 'expense', amount: 12000 } },
  { id: 2, date: '2026-09-07', slot: 'lunch', menu: '떡볶이', category_id: 22, created_at: '2026-09-07T05:00:00Z', transaction_id: 92, tx: { id: 92, kind: 'expense', amount: 8000 } },
  { id: 3, date: '2026-09-07', slot: 'dinner', menu: '김치찌개', category_id: 20, created_at: '2026-09-07T11:00:00Z', transaction_id: null, tx: null },
  { id: 4, date: '2026-09-08', slot: 'lunch', menu: '김밥', category_id: 21, created_at: '2026-09-08T04:00:00Z', transaction_id: 93, tx: { id: 93, kind: 'income', amount: 5000 } },
];
const mealCats = [
  { id: 20, name: '집밥', kind: 'meal' },
  { id: 21, name: '배달', kind: 'meal' },
  { id: 22, name: '포장', kind: 'meal' },
];

test('mealAmount: 연결이 없거나 지출이 아니면 0', () => {
  assert.equal(mealAmount(meals[0]), 12000);
  assert.equal(mealAmount(meals[2]), 0);  // 돈 안 쓴 끼니
  assert.equal(mealAmount(meals[3]), 0);  // 가계부에서 수입으로 바뀐 거래는 안 센다
});

test('groupMealsBySlot: 같은 끼니 여러 건은 만든 순', () => {
  const g = groupMealsBySlot(meals);
  assert.deepEqual(g.get('2026-09-07|lunch').map((m) => m.id), [1, 2]);
  assert.deepEqual(g.get('2026-09-07|dinner').map((m) => m.id), [3]);
  assert.equal(g.get('2026-09-07|breakfast'), undefined);
});

test('sumMeals: 돈 안 쓴 끼니는 합계에서 빠진다', () => {
  assert.deepEqual(sumMeals(meals), { total: 20000, count: 4, paid: 2, home: 2 });
  assert.deepEqual(sumMeals([]), { total: 0, count: 0, paid: 0, home: 0 });
});

test('sumMealsByDate: 날짜별 합계', () => {
  const by = sumMealsByDate(meals);
  assert.equal(by.get('2026-09-07'), 20000);
  assert.equal(by.get('2026-09-08'), 0);
});

test('sumMealsByCategory: 큰 순, 이름 붙임', () => {
  assert.deepEqual(sumMealsByCategory(meals, mealCats), [
    { id: 21, name: '배달', total: 12000, count: 2 },
    { id: 22, name: '포장', total: 8000, count: 1 },
    { id: 20, name: '집밥', total: 0, count: 1 },
  ]);
});

const input = { date: '2026-09-07', slot: 'lunch', menu: ' 제육덮밥 ', bought: '', categoryId: 21, amount: 12000 };
const opts = { categoryId: 1, memo: '점심 · 제육덮밥 · 배달' };

test('planMealSave: 금액과 함께 새로 만들면 거래를 insert 하고 링크한다', () => {
  const p = planMealSave(null, input, opts);
  assert.equal(p.tx.op, 'insert');
  assert.deepEqual(p.tx.payload, { kind: 'expense', amount: 12000, category_id: 1, date: '2026-09-07', memo: opts.memo });
  assert.equal(p.meal.op, 'insert');
  assert.equal(p.meal.link, 'new');
  assert.equal(p.meal.patch.menu, '제육덮밥'); // 앞뒤 공백 제거
});

test('planMealSave: 금액 없이 만들면 거래를 만들지 않는다', () => {
  const p = planMealSave(null, { ...input, amount: 0 }, opts);
  assert.equal(p.tx.op, 'none');
  assert.equal(p.meal.link, 'null');
});

test('planMealSave: 금액 없던 기록에 금액을 채우면 거래를 insert 한다', () => {
  const p = planMealSave({ id: 5, transaction_id: null }, input, opts);
  assert.equal(p.tx.op, 'insert');
  assert.equal(p.meal.op, 'update');
  assert.equal(p.meal.id, 5);
  assert.equal(p.meal.link, 'new');
});

test('planMealSave: 금액을 지우면 거래를 delete 하고 링크를 끊는다', () => {
  const p = planMealSave({ id: 5, transaction_id: 91 }, { ...input, amount: 0 }, opts);
  assert.deepEqual(p.tx, { op: 'delete', id: 91 });
  assert.equal(p.meal.link, 'null');
});

test('planMealSave: 금액을 고치면 거래를 update 하고 링크는 유지한다', () => {
  const p = planMealSave({ id: 5, transaction_id: 91 }, { ...input, amount: 15000 }, opts);
  assert.equal(p.tx.op, 'update');
  assert.equal(p.tx.id, 91);
  assert.equal(p.tx.payload.amount, 15000);
  assert.equal(p.meal.link, 'keep');
});

test('planMealSave: 거래 날짜는 끼니 날짜를 따라간다', () => {
  const p = planMealSave({ id: 5, transaction_id: 91 }, { ...input, date: '2026-09-10' }, opts);
  assert.equal(p.tx.payload.date, '2026-09-10');
  assert.equal(p.meal.patch.date, '2026-09-10');
});

test('planMealSave: 돈 안 쓴 기록을 고쳐도 가계부는 건드리지 않는다', () => {
  const p = planMealSave({ id: 5, transaction_id: null }, { ...input, menu: '김치찌개', amount: 0 }, opts);
  assert.equal(p.tx.op, 'none');
  assert.equal(p.meal.op, 'update');
  assert.equal(p.meal.patch.menu, '김치찌개');
});

test('planMealDelete: 연결된 거래도 함께 지운다', () => {
  assert.deepEqual(planMealDelete({ id: 5, transaction_id: 91 }), {
    tx: { op: 'delete', id: 91 },
    meal: { op: 'delete', id: 5 },
  });
  assert.deepEqual(planMealDelete({ id: 6, transaction_id: null }), {
    tx: { op: 'none' },
    meal: { op: 'delete', id: 6 },
  });
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
