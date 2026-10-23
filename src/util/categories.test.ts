import { describe, expect, it } from 'vitest';
import { categoryOptions, moveItem, normalizeOrder, validateCategoryName } from './categories';

describe('validateCategoryName', () => {
  const existing = ['식비', '교통'];

  it('앞뒤 공백을 지운 이름을 돌려준다', () => {
    expect(validateCategoryName('  반려동물 ', existing)).toEqual({ ok: true, name: '반려동물' });
  });

  it('빈 이름은 거절한다', () => {
    expect(validateCategoryName('   ', existing)).toEqual({ ok: false, error: '분류 이름을 입력하세요.' });
  });

  it('20자는 허용하고 21자는 거절한다(글자 수 기준)', () => {
    expect(validateCategoryName('가'.repeat(20), existing).ok).toBe(true);
    expect(validateCategoryName('가'.repeat(21), existing).ok).toBe(false);
    expect(validateCategoryName('😀'.repeat(20), existing).ok).toBe(true);
  });

  it('같은 구분에 이미 있는 이름은 거절한다', () => {
    expect(validateCategoryName('식비', existing)).toEqual({ ok: false, error: '이미 있는 분류입니다.' });
    expect(validateCategoryName(' 식비 ', existing).ok).toBe(false);
  });

  it('이름을 바꾸는 중에는 자기 자신의 현재 이름과 같아도 된다', () => {
    expect(validateCategoryName('식비', existing, '식비')).toEqual({ ok: true, name: '식비' });
    expect(validateCategoryName('교통', existing, '식비').ok).toBe(false);
  });
});

describe('categoryOptions', () => {
  it('목록에 있으면 그대로 돌려준다', () => {
    expect(categoryOptions(['식비', '교통'], '교통')).toEqual([
      { value: '식비', label: '식비' },
      { value: '교통', label: '교통' },
    ]);
  });

  it('삭제된 분류가 선택되어 있으면 표시를 붙여 마지막에 추가한다', () => {
    expect(categoryOptions(['식비'], '반려동물')).toEqual([
      { value: '식비', label: '식비' },
      { value: '반려동물', label: '반려동물 (삭제된 분류)' },
    ]);
  });

  it('선택값이 없으면 목록만 돌려준다', () => {
    expect(categoryOptions(['식비'], null)).toEqual([{ value: '식비', label: '식비' }]);
    expect(categoryOptions(['식비'], '')).toEqual([{ value: '식비', label: '식비' }]);
  });
});

describe('moveItem / normalizeOrder', () => {
  it('항목을 위아래로 옮기고 범위를 벗어나면 null', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toBeNull();
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toBeNull();
    expect(moveItem(['a'], 5, 1)).toBeNull();
  });

  it('원본 배열은 바꾸지 않는다', () => {
    const list = ['a', 'b'];
    moveItem(list, 0, 1);
    expect(list).toEqual(['a', 'b']);
  });

  it('순서가 바뀐 항목만 sort_order를 0부터 다시 매긴다', () => {
    const list = [
      { id: 'b', sort_order: 1 },
      { id: 'a', sort_order: 0 },
      { id: 'c', sort_order: 2 },
    ];
    expect(normalizeOrder(list)).toEqual([
      { id: 'b', sort_order: 0 },
      { id: 'a', sort_order: 1 },
    ]);
  });

  it('값이 같은 항목(동점)이 있어도 연속된 값으로 정리한다', () => {
    const list = [
      { id: 'a', sort_order: 0 },
      { id: 'b', sort_order: 0 },
      { id: 'c', sort_order: 0 },
    ];
    expect(normalizeOrder(list)).toEqual([
      { id: 'b', sort_order: 1 },
      { id: 'c', sort_order: 2 },
    ]);
  });
});
