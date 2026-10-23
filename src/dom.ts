export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소를 찾을 수 없습니다.`);
  return el as T;
}

/** 문자열을 파일로 내려받는다. 이 페이지는 일반 웹 페이지라 Blob 링크 다운로드가 동작한다. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastTimer: number | undefined;

export function toast(message: string): void {
  const el = $('toast');
  const text = el.firstElementChild;
  if (text) text.textContent = message;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
}
