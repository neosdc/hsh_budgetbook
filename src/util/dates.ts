const DOW = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 로컬 시간 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayStr(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 'YYYY-MM-DD' -> 'YYYY-MM' */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** 해당 월의 [시작일, 다음 달 1일) 범위. 조회는 gte(시작) + lt(끝)로 한다. */
export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  return [`${month}-01`, `${next}-01`];
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** '2026-10-23' -> '23일 금요일' */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d}일 ${DOW[new Date(y, m - 1, d).getDay()]}요일`;
}

/** '2026-10-23' -> '2026년 10월 23일 금요일' (여러 달에 걸친 목록용) */
export function fullDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일 ${DOW[new Date(y, m - 1, d).getDay()]}요일`;
}

/** '2026-10' -> '2026년 10월' */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}년 ${m}월`;
}
