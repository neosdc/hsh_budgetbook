import type { Tx } from '../types';

const TYPE_LABEL: Record<Tx['type'], string> = { expense: '지출', income: '수입' };

/**
 * CSV 셀 하나를 만든다.
 * - 쉼표, 따옴표, 줄바꿈이 있으면 따옴표로 감싸고 내부 따옴표를 두 번 쓴다.
 * - 문자열이 = + - @ 탭 CR 로 시작하면 엑셀이 수식으로 해석하지 않도록 앞에 '를 붙인다.
 */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 날짜 오름차순(같은 날짜는 등록 순)으로 정렬한 CSV 본문. 엑셀의 한글 깨짐을 막기 위해 BOM을 붙인다. */
export function toCsv(rows: readonly Tx[]): string {
  const sorted = [...rows].sort((a, b) =>
    a.occurred_on !== b.occurred_on
      ? a.occurred_on < b.occurred_on
        ? -1
        : 1
      : a.created_at < b.created_at
        ? -1
        : a.created_at > b.created_at
          ? 1
          : 0,
  );
  const lines = [['날짜', '구분', '분류', '금액', '메모', '위치·사람'].join(',')];
  for (const t of sorted) {
    lines.push([t.occurred_on, TYPE_LABEL[t.type], t.category, t.amount, t.memo, t.place].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** 파일 이름에 쓸 수 없는 문자를 지우고 길이를 제한한다. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '_').trim();
  return cleaned.slice(0, 60) || 'export';
}
