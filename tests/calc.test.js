// js/calc.js 순수 함수 검증. 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthRange, shiftMonth, monthLabel, summarize, sumByCategory,
  groupByDate, formatWon, parseWon, dueLabel, sortTodos,
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
