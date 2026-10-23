export const CATEGORY_NAME_MAX = 20;

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/**
 * 분류 이름을 검사한다. 앞뒤 공백은 지우고, 1~20자(글자 수 기준)여야 하며,
 * 같은 구분 안의 다른 분류와 이름이 같으면 안 된다.
 * `current`는 이름을 바꾸는 중인 분류의 현재 이름이다(자기 자신과는 겹쳐도 된다).
 */
export function validateCategoryName(raw: string, existing: readonly string[], current?: string): NameCheck {
  const name = raw.trim();
  if (name === '') return { ok: false, error: '분류 이름을 입력하세요.' };
  if (Array.from(name).length > CATEGORY_NAME_MAX) {
    return { ok: false, error: `분류 이름은 ${CATEGORY_NAME_MAX}자 이하여야 합니다.` };
  }
  if (name !== current && existing.includes(name)) return { ok: false, error: '이미 있는 분류입니다.' };
  return { ok: true, name };
}

export interface CategoryOption {
  value: string;
  label: string;
}

/**
 * 입력창의 분류 선택지. 수정 중인 내역의 분류가 삭제되어 목록에 없으면,
 * 값을 잃지 않도록 "(삭제된 분류)" 표시를 붙여 마지막에 추가한다.
 */
export function categoryOptions(names: readonly string[], selected: string | null): CategoryOption[] {
  const options = names.map((n) => ({ value: n, label: n }));
  if (selected && !names.includes(selected)) {
    options.push({ value: selected, label: `${selected} (삭제된 분류)` });
  }
  return options;
}

/** sort_order가 0부터 연속된 값이 되도록, 바뀌어야 하는 항목만 골라 낸다. */
export function normalizeOrder<T extends { id: string; sort_order: number }>(
  ordered: readonly T[],
): { id: string; sort_order: number }[] {
  const changes: { id: string; sort_order: number }[] = [];
  ordered.forEach((item, index) => {
    if (item.sort_order !== index) changes.push({ id: item.id, sort_order: index });
  });
  return changes;
}

/** 목록에서 index 항목을 delta(-1 위, +1 아래)만큼 옮긴 새 배열. 범위를 벗어나면 null. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] | null {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return null;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
