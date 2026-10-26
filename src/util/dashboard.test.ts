import { describe, expect, it } from 'vitest';
import type { Category, Tx } from '../types';
import {
  buildGrid,
  buildLanes,
  dayColumns,
  daysOfMonth,
  heightRatio,
  heightTicks,
  monthColumns,
  tickLabel,
  topExpenseLane,
  windowRange,
} from './dashboard';

function tx(type: Tx['type'], amount: number, occurred_on: string, category: string, memo = ''): Tx {
  return { id: `${occurred_on}-${category}-${amount}`, type, amount, occurred_on, category, memo, created_at: `${occurred_on}T00:00:00Z` };
}

const cats: Category[] = [
  { id: '1', type: 'expense', name: '교통', sort_order: 1 },
  { id: '2', type: 'expense', name: '식비', sort_order: 0 },
  { id: '3', type: 'income', name: '급여', sort_order: 0 },
];

describe('daysOfMonth / dayColumns', () => {
  it('윤년 2월과 31일 달의 날짜 수', () => {
    expect(daysOfMonth('2028-02')).toHaveLength(29);
    expect(daysOfMonth('2026-10')).toHaveLength(31);
    expect(daysOfMonth('2026-10')[0]).toBe('2026-10-01');
  });

  it('1일, 5의 배수, 말일에만 이름을 표시하고 말일 바로 앞 30일은 생략한다', () => {
    const shown = dayColumns('2026-10').filter((c) => c.showLabel).map((c) => c.label);
    expect(shown).toEqual(['1', '5', '10', '15', '20', '25', '31']);
    const feb = dayColumns('2026-02').filter((c) => c.showLabel).map((c) => c.label);
    expect(feb).toEqual(['1', '5', '10', '15', '20', '25', '28']);
  });
});

describe('monthColumns', () => {
  it('최근 12개월, 첫 달과 1월에 연도를 붙인다', () => {
    const cols = monthColumns('2026-10');
    expect(cols).toHaveLength(12);
    expect(cols[0]).toMatchObject({ key: '2025-11', label: '25년 11월' });
    expect(cols[2]).toMatchObject({ key: '2026-01', label: '26년 1월' });
    expect(cols[11]).toMatchObject({ key: '2026-10', label: '10월' });
  });
});

describe('buildLanes', () => {
  it('수입 다음 지출, 사용자 순서, 삭제된 분류는 구분 끝에 가나다순', () => {
    const rows = [tx('expense', 1000, '2026-10-01', '취미'), tx('expense', 1000, '2026-10-01', '경조사'), tx('income', 5, '2026-10-01', '이자')];
    expect(buildLanes(cats, rows)).toEqual([
      { type: 'income', category: '급여' },
      { type: 'income', category: '이자' },
      { type: 'expense', category: '식비' },
      { type: 'expense', category: '교통' },
      { type: 'expense', category: '경조사' },
      { type: 'expense', category: '취미' },
    ]);
  });

  it('같은 이름이라도 구분이 다르면 다른 줄이다', () => {
    const lanes = buildLanes([{ id: 'a', type: 'income', name: '기타', sort_order: 0 }, { id: 'b', type: 'expense', name: '기타', sort_order: 0 }], []);
    expect(lanes).toHaveLength(2);
  });
});

describe('buildGrid', () => {
  const rows = [
    tx('expense', 3000, '2026-10-02', '식비'),
    tx('expense', 7000, '2026-10-02', '식비'),
    tx('expense', 1250, '2026-10-05', '교통'),
    tx('income', 4_000_000, '2026-10-10', '급여'),
    tx('expense', 999, '2026-09-30', '식비'), // 열 밖
  ];

  it('일별: 같은 날 같은 분류는 한 칸으로 합산하고, 기간 밖은 무시한다', () => {
    const lanes = buildLanes(cats, rows);
    const g = buildGrid('days', rows, dayColumns('2026-10'), lanes);
    expect(g.cells).toHaveLength(3);
    const food = g.cells.find((c) => lanes[c.lane].category === '식비')!;
    expect(food).toMatchObject({ col: 1, total: 10000 });
    expect(food.rows).toHaveLength(2);
    expect(g.income).toBe(4_000_000);
    expect(g.expense).toBe(11_250);
    expect(g.max).toBe(5_000_000);
  });

  it('월별: 같은 달의 내역을 한 칸으로 합산한다', () => {
    const lanes = buildLanes(cats, rows);
    const g = buildGrid('months', rows, monthColumns('2026-10'), lanes);
    const food = g.cells.filter((c) => lanes[c.lane].category === '식비');
    expect(food.map((c) => [c.col, c.total])).toEqual([
      [10, 999],
      [11, 10000],
    ]);
  });

  it('내역이 없으면 칸도 없고 max는 1', () => {
    const g = buildGrid('days', [], dayColumns('2026-10'), buildLanes(cats, []));
    expect(g.cells).toEqual([]);
    expect(g.max).toBe(1);
    expect(topExpenseLane(g)).toBeNull();
  });

  it('지출이 가장 큰 분류', () => {
    const lanes = buildLanes(cats, rows);
    const g = buildGrid('days', rows, dayColumns('2026-10'), lanes);
    expect(topExpenseLane(g)).toEqual({ category: '식비', total: 10000 });
  });
});

describe('heightRatio / heightTicks', () => {
  it('linear는 비례, sqrt는 제곱근, 범위는 0~1', () => {
    expect(heightRatio(250, 1000, 'linear')).toBe(0.25);
    expect(heightRatio(250, 1000, 'sqrt')).toBe(0.5);
    expect(heightRatio(5000, 1000, 'linear')).toBe(1);
    expect(heightRatio(0, 1000, 'sqrt')).toBe(0);
    expect(heightRatio(10, 0, 'linear')).toBe(0);
  });

  it('눈금은 어느 축척에서든 높이 1/4 간격에 놓인다', () => {
    for (const scale of ['linear', 'sqrt'] as const) {
      const ticks = heightTicks(1600, scale);
      expect(ticks.map((v) => heightRatio(v, 1600, scale))).toEqual([0.25, 0.5, 0.75, 1]);
    }
  });
});

describe('tickLabel', () => {
  it('억/만/원 단위 축약', () => {
    expect(tickLabel(150_000_000)).toBe('1.5억');
    expect(tickLabel(2_500_000)).toBe('250만');
    expect(tickLabel(625_000)).toBe('62.5만');
    expect(tickLabel(12_000_000)).toBe('1,200만');
    expect(tickLabel(8000)).toBe('8,000');
  });
});

describe('windowRange', () => {
  it('기준 달로 끝나는 12개월의 [시작, 끝)', () => {
    expect(windowRange('2026-10')).toEqual(['2025-11-01', '2026-11-01']);
    expect(windowRange('2026-12')).toEqual(['2026-01-01', '2027-01-01']);
  });
});
