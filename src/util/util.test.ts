import { describe, expect, it } from 'vitest';
import type { Tx } from '../types';
import { dayLabel, monthLabel, monthOf, monthRange, shiftMonth, todayStr } from './dates';
import { digitsOnly, esc, won } from './format';
import { compareTx, expenseByCategory, groupByDate, sums } from './summary';

function tx(partial: Partial<Tx> & Pick<Tx, 'type' | 'amount'>): Tx {
  return {
    id: Math.random().toString(36).slice(2),
    occurred_on: '2026-10-23',
    category: '식비',
    memo: '',
    created_at: '2026-10-23T00:00:00Z',
    ...partial,
  };
}

describe('dates', () => {
  it('월 범위는 다음 달 1일을 배타적 끝으로 한다', () => {
    expect(monthRange('2026-10')).toEqual(['2026-10-01', '2026-11-01']);
    expect(monthRange('2026-12')).toEqual(['2026-12-01', '2027-01-01']);
    expect(monthRange('2026-02')).toEqual(['2026-02-01', '2026-03-01']);
  });

  it('월 이동은 연도 경계를 넘는다', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });

  it('오늘 날짜와 월 추출', () => {
    expect(todayStr(new Date(2026, 9, 3))).toBe('2026-10-03');
    expect(monthOf('2026-10-23')).toBe('2026-10');
  });

  it('요일과 월 라벨', () => {
    expect(dayLabel('2026-10-23')).toBe('23일 금요일');
    expect(monthLabel('2026-10')).toBe('2026년 10월');
  });
});

describe('format', () => {
  it('천 단위 쉼표', () => {
    expect(won(1234567)).toBe('1,234,567');
  });

  it('HTML 이스케이프', () => {
    expect(esc('<b a="1">&\'</b>')).toBe('&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;');
  });

  it('숫자만 남기고 앞의 0과 13자리 이상은 제거한다', () => {
    expect(digitsOnly('00,12a3')).toBe('123');
    expect(digitsOnly('1234567890123456')).toBe('123456789012');
    expect(digitsOnly('')).toBe('');
  });
});

describe('summary', () => {
  const rows = [
    tx({ type: 'income', amount: 3000000, category: '급여', occurred_on: '2026-10-25' }),
    tx({ type: 'expense', amount: 12000, category: '식비', occurred_on: '2026-10-23' }),
    tx({ type: 'expense', amount: 8000, category: '교통', occurred_on: '2026-10-23', created_at: '2026-10-23T05:00:00Z' }),
    tx({ type: 'expense', amount: 30000, category: '식비', occurred_on: '2026-10-01' }),
  ];

  it('수입/지출 합계', () => {
    expect(sums(rows)).toEqual({ income: 3000000, expense: 50000 });
    expect(sums([])).toEqual({ income: 0, expense: 0 });
  });

  it('같은 날짜는 최근 등록이 먼저', () => {
    const [a, b] = [rows[1], rows[2]];
    expect(compareTx(a, b)).toBeGreaterThan(0);
  });

  it('날짜별 묶음은 최신 날짜부터', () => {
    const groups = groupByDate(rows);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-25', '2026-10-23', '2026-10-01']);
    expect(groups[1].rows.map((r) => r.category)).toEqual(['교통', '식비']);
  });

  it('지출 분류 합계는 수입을 제외하고 큰 순서로 정렬된다', () => {
    const cats = expenseByCategory(rows);
    expect(cats.map((c) => c.category)).toEqual(['식비', '교통']);
    expect(cats[0].total).toBe(42000);
    expect(Math.round(cats[0].percent)).toBe(84);
    expect(expenseByCategory([])).toEqual([]);
  });
});
