// js/calc.js 순수 함수 검증. 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthRange, shiftMonth, monthLabel, summarize, sumByCategory,
  groupByDate, formatWon, parseWon, dueLabel, sortTodos,
  calendarGrid, groupEventsByDate, formatTime, spanRange, rangeLabel, monthsBetween, sumByMonth, shiftDay,
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
