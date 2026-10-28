import { describe, expect, it } from 'vitest';
import type { Tx } from '../types';
import { esc } from './format';
import migrationSql from '../../supabase/migrations/20261026000000_add_place.sql?raw';
import { groupByPlace, incomeRatioLabel, isPlaceValue, PERSONS, percentLabel, placeLabel, placeOptionsHtml, PLACES, resolvePlace } from './places';

function tx(amount: number, category: string, place: string, type: Tx['type'] = 'expense', occurred_on = '2026-10-10'): Tx {
  return { id: `${category}-${amount}`, type, amount, occurred_on, category, memo: '', place, created_at: `${occurred_on}T00:00:00Z` };
}

describe('resolvePlace', () => {
  it('사람 이름은 그 사람의 자리로', () => {
    expect(resolvePlace('승영')).toEqual({ place: '서재', kind: 'person' });
    expect(resolvePlace('윤지')).toEqual({ place: '윤지방', kind: 'person' });
    expect(resolvePlace('윤솔')).toEqual({ place: '윤지방', kind: 'person' });
    expect(resolvePlace('지혜')).toEqual({ place: '드레스룸', kind: 'person' });
  });

  it('위치 이름은 그 자리로, 앞뒤 공백은 무시한다', () => {
    expect(resolvePlace('현관')).toEqual({ place: '현관', kind: 'place' });
    expect(resolvePlace(' 부엌 ')).toEqual({ place: '부엌', kind: 'place' });
  });

  it('빈 값은 거실, 목록에 없는 값은 거실이지만 unknown으로 표시', () => {
    expect(resolvePlace('')).toEqual({ place: '거실', kind: 'empty' });
    expect(resolvePlace(null)).toEqual({ place: '거실', kind: 'empty' });
    expect(resolvePlace('베란다')).toEqual({ place: '거실', kind: 'unknown' });
  });
});

describe('입력 목록', () => {
  it('목록 값과 빈 값만 허용한다', () => {
    for (const v of ['', ...PERSONS, ...PLACES]) expect(isPlaceValue(v)).toBe(true);
    expect(isPlaceValue('베란다')).toBe(false);
  });

  it('DB check 제약과 앱 목록이 같다', () => {
    const lists = [...migrationSql.matchAll(/place in \(([^)]*)\)/g)].map((m) => [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).sort());
    expect(lists).toHaveLength(2);
    const app = ['', ...PERSONS, ...PLACES].sort();
    for (const l of lists) expect(l).toEqual(app);
  });

  it('select 옵션: 선택 표시, 사람과 위치 묶음, 목록에 없는 기존 값 보존', () => {
    const html = placeOptionsHtml('윤지', esc);
    expect(html).toContain('<option value="윤지" selected>윤지</option>');
    expect(html).toContain('<optgroup label="사람">');
    expect(html).toContain('<optgroup label="위치">');
    expect(placeOptionsHtml('베란다', esc)).toContain('<option value="베란다" selected>베란다 (목록에 없는 값)</option>');
  });

  it('짧은 설명', () => {
    expect(placeLabel('윤솔')).toBe('윤솔 · 윤지방');
    expect(placeLabel('부엌')).toBe('부엌');
    expect(placeLabel('')).toBe('');
  });
});

describe('groupByPlace', () => {
  it('지출만 자리 × 분류로 묶고, 자리마다 큰 금액부터', () => {
    const g = groupByPlace([
      tx(1000, '식비', '부엌'),
      tx(500, '식비', '부엌'),
      tx(3000, '카페·간식', '부엌'),
      tx(2000, '식비', ''),
      tx(9000, '교육', '윤솔'),
      tx(100000, '급여', '승영', 'income'),
    ]);
    expect(g.get('부엌')!.map((x) => [x.category, x.total, x.rows.length])).toEqual([
      ['카페·간식', 3000, 1],
      ['식비', 1500, 2],
    ]);
    expect(g.get('거실')!.map((x) => x.total)).toEqual([2000]);
    expect(g.get('윤지방')!.map((x) => x.category)).toEqual(['교육']);
    expect(g.get('서재')).toEqual([]);
    expect([...g.keys()]).toEqual([...PLACES]);
  });
});

describe('incomeRatioLabel', () => {
  it('수입 100만, 지출 70만이면 지출 70.0%, 잔액 30.0%', () => {
    expect(incomeRatioLabel(700_000, 1_000_000)).toBe('70.0%');
    expect(incomeRatioLabel(300_000, 1_000_000)).toBe('30.0%');
  });
  it('지출이 수입보다 많으면 지출은 100% 초과, 잔액은 음수', () => {
    expect(incomeRatioLabel(1_250_000, 1_000_000)).toBe('125.0%');
    expect(incomeRatioLabel(-250_000, 1_000_000)).toBe('−25.0%');
  });
  it('수입이 없으면 null', () => {
    expect(incomeRatioLabel(5000, 0)).toBeNull();
  });
});

describe('percentLabel', () => {
  it('소수 한 자리', () => {
    expect(percentLabel(3024334, 3917444)).toBe('77.2%');
    expect(percentLabel(0, 0)).toBe('0.0%');
    expect(percentLabel(1, 1)).toBe('100.0%');
  });
});
