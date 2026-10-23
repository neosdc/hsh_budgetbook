import { describe, expect, it } from 'vitest';
import type { Tx } from '../types';
import { MAX_CATCH_UP, dueOccurrences, occurrenceDate } from './recurring';
import { compactWon, lastMonths, monthlyTotals, niceMax, topExpenseCategories } from './trend';

const rule = (over: Partial<Parameters<typeof dueOccurrences>[0]> = {}) => ({
  day_of_month: 5,
  start_date: '2026-08-01',
  end_date: null,
  generated_through: null,
  ...over,
});

describe('occurrenceDate', () => {
  it('없는 날짜는 말일로 맞춘다', () => {
    expect(occurrenceDate(2026, 2, 31)).toBe('2026-02-28');
    expect(occurrenceDate(2028, 2, 30)).toBe('2028-02-29');
    expect(occurrenceDate(2026, 4, 31)).toBe('2026-04-30');
    expect(occurrenceDate(2026, 10, 5)).toBe('2026-10-05');
  });
});

describe('dueOccurrences', () => {
  it('시작한 달부터 오늘까지 지난 회차를 모두 만든다 (밀린 회차 따라잡기)', () => {
    const d = dueOccurrences(rule(), '2026-10-23');
    expect(d.items.map((x) => x.occurred_on)).toEqual(['2026-08-05', '2026-09-05', '2026-10-05']);
    expect(d.items[0].period).toBe('2026-08-01');
    expect(d.through).toBe('2026-10-01');
  });

  it('이번 달 날짜가 아직 안 왔으면 그 달은 만들지도 처리하지도 않는다', () => {
    const d = dueOccurrences(rule({ day_of_month: 25 }), '2026-10-23');
    expect(d.items.map((x) => x.period)).toEqual(['2026-08-01', '2026-09-01']);
    expect(d.through).toBe('2026-09-01');
    // 25일이 되면 이어서 만든다
    const next = dueOccurrences(rule({ day_of_month: 25, generated_through: '2026-09-01' }), '2026-10-25');
    expect(next.items.map((x) => x.occurred_on)).toEqual(['2026-10-25']);
  });

  it('이미 처리한 달 이후만 만들고, 더 할 일이 없으면 through가 null', () => {
    const d = dueOccurrences(rule({ generated_through: '2026-10-01' }), '2026-10-23');
    expect(d).toEqual({ items: [], through: null });
  });

  it('시작일 이전 회차는 건너뛰되 처리한 것으로 센다', () => {
    const d = dueOccurrences(rule({ start_date: '2026-10-10' }), '2026-10-23');
    expect(d.items).toEqual([]);
    expect(d.through).toBe('2026-10-01');
    const later = dueOccurrences(rule({ start_date: '2026-10-10', generated_through: '2026-10-01' }), '2026-11-06');
    expect(later.items.map((x) => x.occurred_on)).toEqual(['2026-11-05']);
  });

  it('시작일이 미래이면 아무것도 하지 않는다', () => {
    expect(dueOccurrences(rule({ start_date: '2027-01-01' }), '2026-10-23')).toEqual({ items: [], through: null });
  });

  it('종료일 이후 회차는 만들지 않는다', () => {
    const d = dueOccurrences(rule({ end_date: '2026-09-05' }), '2026-10-23');
    expect(d.items.map((x) => x.occurred_on)).toEqual(['2026-08-05', '2026-09-05']);
  });

  it('31일 규칙은 짧은 달에 말일로 기록하고 연도를 넘긴다', () => {
    const d = dueOccurrences(rule({ day_of_month: 31, start_date: '2026-11-01' }), '2027-03-31');
    expect(d.items.map((x) => x.occurred_on)).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('너무 오래된 시작일은 최근 회차만 남긴다', () => {
    const d = dueOccurrences(rule({ start_date: '2000-01-01' }), '2026-10-23');
    expect(d.items).toHaveLength(MAX_CATCH_UP);
    expect(d.items.at(-1)!.occurred_on).toBe('2026-10-05');
  });
});

const tx = (date: string, type: Tx['type'], amount: number, category = '식비'): Tx => ({
  id: date + type + amount + category,
  type,
  amount,
  occurred_on: date,
  category,
  memo: '',
  created_at: date,
});

describe('trend', () => {
  it('lastMonths: 연도를 넘어 오래된 달부터', () => {
    expect(lastMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
  it('monthlyTotals: 빈 달은 0, 범위 밖 내역은 무시', () => {
    const months = lastMonths('2026-10', 3);
    const t = monthlyTotals(
      [tx('2026-08-10', 'expense', 100), tx('2026-10-01', 'income', 500), tx('2026-10-31', 'expense', 200), tx('2026-07-31', 'expense', 9)],
      months,
    );
    expect(t).toEqual([
      { month: '2026-08', income: 0, expense: 100, balance: -100 },
      { month: '2026-09', income: 0, expense: 0, balance: 0 },
      { month: '2026-10', income: 500, expense: 200, balance: 300 },
    ]);
  });
  it('topExpenseCategories: 지출만, 큰 순서, 개수 제한', () => {
    const rows = [tx('2026-10-01', 'expense', 100, 'a'), tx('2026-10-02', 'expense', 300, 'b'), tx('2026-10-03', 'expense', 50, 'a'), tx('2026-10-04', 'income', 9999, 'c')];
    expect(topExpenseCategories(rows, 1)).toEqual([{ category: 'b', total: 300 }]);
    expect(topExpenseCategories(rows, 5).map((x) => x.category)).toEqual(['b', 'a']);
  });
  it('niceMax / compactWon', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(130)).toBe(200);
    expect(niceMax(2_100_000)).toBe(2_500_000);
    expect(niceMax(3_000_000)).toBe(5_000_000);
    expect(niceMax(10_000_000)).toBe(10_000_000);
    expect(compactWon(8000)).toBe('8,000');
    expect(compactWon(500_000)).toBe('50만');
    expect(compactWon(30_000_000)).toBe('3,000만');
    expect(compactWon(150_000_000)).toBe('1.5억');
    expect(compactWon(0)).toBe('0');
  });
});
