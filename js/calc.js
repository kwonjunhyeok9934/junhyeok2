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
