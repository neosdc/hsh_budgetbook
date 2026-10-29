import { describe, expect, it } from 'vitest';
import type { Tx } from '../types';
import { donutArcs, peopleOf, slicesByCategory, slicesByPerson, splitAmount } from './pies';

let n = 0;
function tx(amount: number, category: string, place = '', type: Tx['type'] = 'expense', occurred_on = '2026-10-10'): Tx {
  n += 1;
  return { id: `t${n}`, type, amount, occurred_on, category, memo: '', place, created_at: `${occurred_on}T00:00:${String(n % 60).padStart(2, '0')}Z` };
}

describe('peopleOf', () => {
  it('사람 이름이면 그 사람, 위치면 그 위치를 쓰는 사람들, 빈 값은 거실', () => {
    expect(peopleOf(tx(1, '식비', '윤솔'))).toEqual(['윤솔']);
    expect(peopleOf(tx(1, '식비', '윤지방'))).toEqual(['윤지', '윤솔']);
    expect(peopleOf(tx(1, '식비', '안방'))).toEqual(['승영', '지혜']);
    expect(peopleOf(tx(1, '식비', '드레스룸'))).toEqual(['지혜']);
    expect(peopleOf(tx(1, '식비', '서재'))).toEqual(['승영']);
    for (const p of ['거실', '현관', '부엌', '']) expect(peopleOf(tx(1, '식비', p))).toEqual(['승영', '지혜', '윤지', '윤솔']);
  });
});

describe('splitAmount', () => {
  it('원 단위로 나누고 나머지는 앞사람부터 1원씩', () => {
    expect(splitAmount(10000, 4)).toEqual([2500, 2500, 2500, 2500]);
    expect(splitAmount(10001, 4)).toEqual([2501, 2500, 2500, 2500]);
    expect(splitAmount(3, 2)).toEqual([2, 1]);
    expect(splitAmount(300, 1)).toEqual([300]);
  });
});

describe('slicesByPerson', () => {
  it('위치에 따라 나눠 합산하고, 합계는 지출 합계와 같다, 수입은 무시', () => {
    const s = slicesByPerson([
      tx(400, '식비', '부엌'), // 4명 100씩
      tx(201, '의료·건강', '윤지방'), // 윤지 101, 윤솔 100
      tx(50, '카페·간식', '안방'), // 승영 25, 지혜 25
      tx(30, '교육', '윤지'),
      tx(9999, '급여', '승영', 'income'),
    ]);
    expect(s.map((x) => [x.key, x.total])).toEqual([
      ['승영', 125],
      ['지혜', 125],
      ['윤지', 231],
      ['윤솔', 200],
    ]);
    expect(s.reduce((a, x) => a + x.total, 0)).toBe(681);
    expect(s.reduce((a, x) => a + x.ratio, 0)).toBeCloseTo(1);
    const yunji = s.find((x) => x.key === '윤지')!;
    expect(yunji.rows.map((t) => t.amount)).toEqual([400, 201, 30]);
    expect(yunji.shares).toEqual([100, 101, 30]);
    expect(yunji.splits).toEqual([4, 2, 1]);
  });

  it('0원인 사람은 빼고, 지출이 없으면 빈 목록', () => {
    expect(slicesByPerson([tx(100, '식비', '서재')]).map((x) => x.key)).toEqual(['승영']);
    expect(slicesByPerson([tx(1, '급여', '', 'income')])).toEqual([]);
  });
});

describe('slicesByCategory', () => {
  it('큰 금액 순서, 다섯 개 넘으면 나머지를 묶는다', () => {
    const rows = [700, 600, 500, 400, 300, 200, 100].map((a, i) => tx(a, `c${i}`));
    const s = slicesByCategory(rows);
    expect(s.map((x) => x.key)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', '그 외 2개 분류']);
    expect(s[5]).toMatchObject({ total: 300, rest: true, members: ['c5', 'c6'] });
    expect(s[5].rows).toHaveLength(2);
  });

  it('나머지가 한 분류뿐이면 묶지 않는다', () => {
    const rows = [600, 500, 400, 300, 200, 100].map((a, i) => tx(a, `c${i}`));
    expect(slicesByCategory(rows).map((x) => x.key)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('같은 분류는 합친다', () => {
    const s = slicesByCategory([tx(100, '식비'), tx(50, '식비'), tx(200, '교통')]);
    expect(s.map((x) => [x.key, x.total, x.rows.length])).toEqual([
      ['교통', 200, 1],
      ['식비', 150, 2],
    ]);
  });
});

describe('donutArcs', () => {
  it('조각마다 경로 하나, 가운데 각도는 12시부터 시계 방향', () => {
    const arcs = donutArcs([1, 1, 2], 50, 50, 40, 25);
    expect(arcs).toHaveLength(3);
    expect(arcs.every((a) => a.d.startsWith('M'))).toBe(true);
    expect(arcs[0].mid).toBeCloseTo(Math.PI / 4);
    expect(arcs[2].mid).toBeCloseTo(Math.PI * 1.5);
  });

  it('반 바퀴가 넘는 조각은 큰 호 플래그를 쓴다', () => {
    const [big] = donutArcs([3, 1], 50, 50, 40, 25);
    expect(big.d).toContain('A40,40 0 1 1');
  });

  it('조각이 하나면 틈 없는 고리 전체', () => {
    const [ring] = donutArcs([5], 50, 50, 40, 25);
    expect(ring.d.match(/A/g)).toHaveLength(4);
  });

  it('합이 0이면 빈 목록', () => {
    expect(donutArcs([0, 0], 50, 50, 40, 25)).toEqual([]);
  });
});
