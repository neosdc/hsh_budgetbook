import { describe, expect, it } from 'vitest';
import type { Tx } from '../types';
import { csvCell, safeFileName, toCsv } from './csv';
import { fullDateLabel } from './dates';
import { buildSearchFilter, ilikePattern, quoteFilterValue } from './search';
import { filterByType } from './summary';

function tx(partial: Partial<Tx> & Pick<Tx, 'type' | 'amount'>): Tx {
  return {
    id: 'x',
    occurred_on: '2026-10-23',
    category: '식비',
    memo: '',
    created_at: '2026-10-23T00:00:00Z',
    ...partial,
  };
}

describe('search filter', () => {
  it('와일드카드와 역슬래시를 글자 그대로 찾도록 이스케이프한다', () => {
    expect(ilikePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
  });

  it('필터 값은 따옴표로 감싸고 내부 따옴표와 역슬래시를 이스케이프한다', () => {
    expect(quoteFilterValue('a,b)"c\\')).toBe('"a,b)\\"c\\\\"');
  });

  it('빈 검색어는 필터가 없다', () => {
    expect(buildSearchFilter('')).toBeNull();
    expect(buildSearchFilter('   ')).toBeNull();
  });

  it('글자 검색어는 메모와 분류만 찾는다', () => {
    expect(buildSearchFilter(' 점심 ')).toBe('memo.ilike."%점심%",category.ilike."%점심%"');
  });

  it('숫자 검색어는 같은 금액도 찾고 쉼표를 무시한다', () => {
    expect(buildSearchFilter('12,000')).toContain(',amount.eq.12000');
    expect(buildSearchFilter('12000')).toContain(',amount.eq.12000');
    expect(buildSearchFilter('12a')).not.toContain('amount.eq');
  });

  it('쉼표나 괄호가 있어도 or() 구문이 깨지지 않도록 한 값으로 묶인다', () => {
    const f = buildSearchFilter('a,b)')!;
    expect(f).toBe('memo.ilike."%a,b)%",category.ilike."%a,b)%"');
  });
});

describe('csv', () => {
  it('쉼표, 따옴표, 줄바꿈이 있으면 따옴표로 감싼다', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(1200)).toBe('1200');
  });

  it('수식으로 해석될 수 있는 문자열 앞에는 작은따옴표를 붙인다', () => {
    expect(csvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@a')).toBe("'@a");
    expect(csvCell('a=b')).toBe('a=b');
  });

  it('BOM, 헤더, 날짜 오름차순으로 만든다', () => {
    const csv = toCsv([
      tx({ type: 'expense', amount: 5000, occurred_on: '2026-10-23', category: '식비', memo: '점심, 김치찌개' }),
      tx({ type: 'income', amount: 3000000, occurred_on: '2026-10-01', category: '급여' }),
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual([
      '날짜,구분,분류,금액,메모',
      '2026-10-01,수입,급여,3000000,',
      '2026-10-23,지출,식비,5000,"점심, 김치찌개"',
      '',
    ]);
  });

  it('내역이 없으면 헤더만 있다', () => {
    expect(toCsv([]).slice(1)).toBe('날짜,구분,분류,금액,메모\r\n');
  });

  it('파일 이름에서 사용할 수 없는 문자를 지운다', () => {
    expect(safeFileName('가계부_검색_a/b:c*?')).toBe('가계부_검색_abc');
    expect(safeFileName('///')).toBe('export');
    expect(safeFileName('x'.repeat(100)).length).toBe(60);
  });
});

describe('misc', () => {
  it('연도가 포함된 날짜 라벨', () => {
    expect(fullDateLabel('2026-10-23')).toBe('2026년 10월 23일 금요일');
  });

  it('구분 필터', () => {
    const rows = [tx({ type: 'expense', amount: 1 }), tx({ type: 'income', amount: 2 })];
    expect(filterByType(rows, 'all')).toHaveLength(2);
    expect(filterByType(rows, 'income').map((r) => r.amount)).toEqual([2]);
  });
});
