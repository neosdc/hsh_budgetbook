/** ILIKE 패턴에서 와일드카드(%, _)와 이스케이프 문자(\)를 글자 그대로 찾도록 이스케이프한 부분 일치 패턴. */
export function ilikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

/** PostgREST 필터 값을 큰따옴표로 감싸 쉼표, 괄호, 점이 구문으로 해석되지 않게 한다. */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * 메모 또는 분류에 검색어가 들어 있거나, 검색어가 숫자면 금액이 정확히 같은 행을 찾는 `or()` 필터 문자열.
 * 검색어가 비어 있으면 null.
 */
export function buildSearchFilter(raw: string): string | null {
  const term = raw.trim();
  if (!term) return null;
  const pattern = quoteFilterValue(ilikePattern(term));
  const parts = [`memo.ilike.${pattern}`, `category.ilike.${pattern}`];
  const digits = term.replace(/,/g, '');
  if (/^\d{1,12}$/.test(digits)) parts.push(`amount.eq.${digits}`);
  return parts.join(',');
}
