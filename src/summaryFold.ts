/*
 * 잔액·수입·지출 요약의 펼침 여부. 가계부와 대시보드가 같은 값을 함께 쓰고 이 기기(localStorage)에 저장한다.
 * 다른 사람 앞에서 금액이 바로 보이지 않도록 기본은 접힘.
 */
const KEY = 'hsh-summary-open';
/** 예전 대시보드 설정(hsh-dash-prefs.summaryOpen). 공통 값이 아직 없을 때만 읽는다. */
const LEGACY_DASH_KEY = 'hsh-dash-prefs';

export function loadSummaryOpen(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v !== null) return v === '1';
    const legacy = JSON.parse(localStorage.getItem(LEGACY_DASH_KEY) ?? '{}') as { summaryOpen?: unknown };
    return legacy.summaryOpen === true;
  } catch {
    return false;
  }
}

export function saveSummaryOpen(open: boolean): void {
  try {
    localStorage.setItem(KEY, open ? '1' : '0');
  } catch {
    // 저장소를 쓸 수 없는 환경이면 기억하지 않는다.
  }
}
