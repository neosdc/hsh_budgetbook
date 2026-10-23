import { digitsOnly } from './util/format';

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

/** 입력창을 천 단위 쉼표가 있는 숫자로 고쳐 쓰고, 쉼표가 늘어나도 커서가 같은 숫자 뒤에 머물게 한다. */
export function formatAmountField(el: HTMLInputElement): void {
  const raw = el.value;
  const pos = el.selectionStart ?? raw.length;
  const digitsBefore = raw.slice(0, pos).replace(/\D/g, '').length;
  const digits = digitsOnly(raw);
  const formatted = digits ? Number(digits).toLocaleString('ko-KR') : '';
  el.value = formatted;
  let counted = 0;
  let next = 0;
  while (next < formatted.length && counted < digitsBefore) {
    if (/\d/.test(formatted[next])) counted++;
    next++;
  }
  el.setSelectionRange(next, next);
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
