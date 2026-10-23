import type { Tx } from '../types';

export interface Sums {
  income: number;
  expense: number;
}

export function sums(rows: readonly Tx[]): Sums {
  let income = 0;
  let expense = 0;
  for (const t of rows) {
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense };
}

/** 날짜 내림차순, 같은 날짜는 최근 등록 순 */
export function compareTx(a: Tx, b: Tx): number {
  if (a.occurred_on !== b.occurred_on) return a.occurred_on < b.occurred_on ? 1 : -1;
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

export interface DayGroup {
  date: string;
  rows: Tx[];
}

/** 정렬된 목록을 날짜별로 묶는다. */
export function groupByDate(rows: readonly Tx[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const t of [...rows].sort(compareTx)) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.occurred_on) last.rows.push(t);
    else groups.push({ date: t.occurred_on, rows: [t] });
  }
  return groups;
}

export interface CategoryTotal {
  category: string;
  total: number;
  /** 0-100 */
  percent: number;
}

/** 지출만 분류별로 합산해 큰 금액 순으로 반환한다. */
export function expenseByCategory(rows: readonly Tx[]): CategoryTotal[] {
  const totals = new Map<string, number>();
  let all = 0;
  for (const t of rows) {
    if (t.type !== 'expense') continue;
    totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
    all += t.amount;
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, total]) => ({ category, total, percent: (total / all) * 100 }));
}
