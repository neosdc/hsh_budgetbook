import type { Tx } from '../types';

/** 기준 달(YYYY-MM)을 마지막으로 하는 최근 n개월(오래된 달부터) */
export function lastMonths(end: string, n: number): string[] {
  const [y, m] = end.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export interface MonthTotal {
  month: string;
  income: number;
  expense: number;
  balance: number;
}

/** 월별 수입/지출/잔액. 내역이 없는 달도 0으로 포함한다. months 밖의 내역은 무시한다. */
export function monthlyTotals(rows: readonly Tx[], months: readonly string[]): MonthTotal[] {
  const map = new Map<string, MonthTotal>(months.map((month) => [month, { month, income: 0, expense: 0, balance: 0 }]));
  for (const t of rows) {
    const cell = map.get(t.occurred_on.slice(0, 7));
    if (!cell) continue;
    if (t.type === 'income') cell.income += t.amount;
    else cell.expense += t.amount;
  }
  return months.map((m) => {
    const c = map.get(m)!;
    return { ...c, balance: c.income - c.expense };
  });
}

/** 기간 전체의 지출 분류 상위 n개(나머지는 "기타 합계"로 묶지 않고 버린다). */
export function topExpenseCategories(rows: readonly Tx[], n: number): { category: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const t of rows) {
    if (t.type === 'expense') totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .slice(0, n)
    .map(([category, total]) => ({ category, total }));
}

/** 막대 그래프 축의 최댓값: 1, 2, 2.5, 5, 10 × 10^k 중 max 이상인 가장 작은 값. max가 0이면 1. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const f of [1, 2, 2.5, 5, 10]) {
    if (f * pow >= max) return f * pow;
  }
  return 10 * pow;
}

/** 축 눈금용 짧은 금액: 1.5억, 3,000만, 50만, 8,000 */
export function compactWon(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  const trim = (v: number): string => String(Math.round(v * 10) / 10);
  if (abs >= 100_000_000) return `${sign}${trim(abs / 100_000_000)}억`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString('ko-KR')}만`;
  return `${sign}${abs.toLocaleString('ko-KR')}`;
}
