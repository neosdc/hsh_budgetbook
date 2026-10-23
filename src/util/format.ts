export function won(n: number): string {
  return n.toLocaleString('ko-KR');
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** 입력창 문자열에서 숫자만 남겨 최대 12자리 정수 문자열로 만든다. */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+/, '').slice(0, 12);
}
