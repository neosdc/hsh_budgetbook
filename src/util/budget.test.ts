import { describe, expect, it } from 'vitest';
import type { Budget, Tx } from '../types';
import { OVERALL, budgetState, budgetStatuses, diffBudgets, parseBudgetInput, worsened } from './budget';

const tx = (category: string, amount: number, type: Tx['type'] = 'expense'): Tx => ({
  id: `${category}${amount}${type}`,
  type,
  amount,
  occurred_on: '2026-10-05',
  category,
  memo: '',
  place: '',
  created_at: '2026-10-05T00:00:00Z',
});
const budget = (category: string, amount: number): Budget => ({ id: `b-${category}`, category, amount });

describe('budgetState', () => {
  it('80% 미만은 ok, 80% 이상 100% 이하는 warn, 초과는 over', () => {
    expect(budgetState(0, 100)).toBe('ok');
    expect(budgetState(79, 100)).toBe('ok');
    expect(budgetState(80, 100)).toBe('warn');
    expect(budgetState(100, 100)).toBe('warn');
    expect(budgetState(101, 100)).toBe('over');
  });
  it('큰 금액에서도 정수로 정확히 비교한다', () => {
    expect(budgetState(8_000_000_000_000, 10_000_000_000_000)).toBe('warn');
    expect(budgetState(7_999_999_999_999, 10_000_000_000_000)).toBe('ok');
  });
});

describe('budgetStatuses', () => {
  const rows = [tx('식비', 30000), tx('식비', 25000), tx('교통', 10000), tx('급여', 999999, 'income')];

  it('전체 예산은 지출 합계(수입 제외), 분류 예산은 그 분류 합계와 비교한다', () => {
    const s = budgetStatuses([budget(OVERALL, 100000), budget('식비', 50000)], rows, ['식비', '교통']);
    expect(s.map((x) => x.key)).toEqual([OVERALL, '식비']);
    expect(s[0]).toMatchObject({ spent: 65000, remaining: 35000, state: 'ok' });
    expect(s[1]).toMatchObject({ spent: 55000, remaining: -5000, state: 'over' });
    expect(s[1].ratio).toBeCloseTo(1.1);
  });

  it('지출이 없는 분류도 0원으로 나오고, 삭제된 분류의 예산은 뒤에 붙는다', () => {
    const s = budgetStatuses([budget('옛분류', 1000), budget('쇼핑', 20000), budget(OVERALL, 1)], [], ['식비', '쇼핑']);
    expect(s.map((x) => x.key)).toEqual([OVERALL, '쇼핑', '옛분류']);
    expect(s[1]).toMatchObject({ spent: 0, state: 'ok' });
  });
});

describe('worsened', () => {
  const st = (key: string, spent: number) => budgetStatuses([budget(key, 100)], [tx(key, spent)])[0];
  it('상태가 나빠진 항목만, 심각한 순서로 돌려준다', () => {
    const before = [st('a', 10), st('b', 85), st('c', 50)];
    const after = [st('a', 90), st('b', 120), st('c', 55)];
    expect(worsened(before, after).map((x) => [x.key, x.state])).toEqual([
      ['b', 'over'],
      ['a', 'warn'],
    ]);
  });
  it('이미 초과였던 항목, 이전에 없던 예산의 ok는 무시한다', () => {
    expect(worsened([st('a', 120)], [st('a', 150)])).toEqual([]);
    expect(worsened([], [st('a', 10)])).toEqual([]);
  });
});

describe('parseBudgetInput / diffBudgets', () => {
  it('숫자만 읽고 비었거나 0이면 null', () => {
    expect(parseBudgetInput('1,234,000')).toBe(1234000);
    expect(parseBudgetInput('')).toBeNull();
    expect(parseBudgetInput('0')).toBeNull();
    expect(parseBudgetInput('abc')).toBeNull();
    expect(parseBudgetInput('9'.repeat(15))).toBe(Number.POSITIVE_INFINITY);
  });
  it('바뀐 것만 추가/수정/삭제로 나눈다', () => {
    const current = [budget(OVERALL, 500000), budget('식비', 200000), budget('교통', 50000)];
    const changes = diffBudgets(current, [
      { key: OVERALL, amount: 500000 },
      { key: '식비', amount: 250000 },
      { key: '교통', amount: null },
      { key: '쇼핑', amount: 70000 },
      { key: '교육', amount: null },
    ]);
    expect(changes.upserts).toEqual([
      { category: '식비', amount: 250000 },
      { category: '쇼핑', amount: 70000 },
    ]);
    expect(changes.deletes).toEqual(['교통']);
  });
});
