import type { Category, Tx, TxType } from '../types';
import { pad } from './dates';
import { lastMonths, niceMax } from './trend';

/** 3D 대시보드의 보기 방식: 한 달을 일별로, 또는 최근 12개월을 월별로 */
export type DashMode = 'days' | 'months';

/** 높이 축척. linear는 금액에 비례, sqrt는 작은 금액이 덜 묻히도록 제곱근에 비례한다. */
export type HeightScale = 'linear' | 'sqrt';

/** 그리드의 한 열(X축): 하루(YYYY-MM-DD) 또는 한 달(YYYY-MM) */
export interface Column {
  key: string;
  /** 축 아래에 쓸 짧은 이름 ('15', '10월') */
  label: string;
  /** 축에 이름을 표시할지. 일별 31칸에 모두 쓰면 겹치므로 일부만 표시한다. */
  showLabel: boolean;
}

/** 그리드의 한 줄(Z축): 구분 + 분류 */
export interface Lane {
  type: TxType;
  category: string;
}

/** 열과 줄이 만나는 칸. 내역이 있는 칸만 만든다. */
export interface Cell {
  col: number;
  lane: number;
  total: number;
  /** 칸에 속한 내역(날짜 오름차순) */
  rows: Tx[];
}

export interface Grid {
  mode: DashMode;
  columns: Column[];
  lanes: Lane[];
  cells: Cell[];
  /** 높이 축의 최댓값(가장 큰 칸 이상인 깔끔한 수) */
  max: number;
  income: number;
  expense: number;
}

/** 해당 월의 모든 날짜(YYYY-MM-DD) */
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${pad(i + 1)}`);
}

/** 일별 열. 1일, 5의 배수, 말일에만 이름을 표시한다(30일·31일처럼 말일과 붙는 25·30은 말일 쪽을 남긴다). */
export function dayColumns(month: string): Column[] {
  const days = daysOfMonth(month);
  const last = days.length;
  return days.map((key, i) => {
    const d = i + 1;
    const show = d === 1 || d === last || (d % 5 === 0 && last - d >= 2);
    return { key, label: String(d), showLabel: show };
  });
}

/** 최근 12개월 열. 모든 달에 이름을 표시하고, 1월과 첫 달에는 연도를 붙인다. */
export function monthColumns(end: string, n = 12): Column[] {
  return lastMonths(end, n).map((key, i) => {
    const [y, m] = key.split('-').map(Number);
    const withYear = i === 0 || m === 1;
    return { key, label: withYear ? `${String(y).slice(2)}년 ${m}월` : `${m}월`, showLabel: true };
  });
}

/**
 * 줄 순서: 수입 분류들, 그다음 지출 분류들(사용자가 정한 순서).
 * 분류 목록에 없지만 내역에 남아 있는 분류(삭제된 분류)는 같은 구분의 끝에 가나다순으로 붙인다.
 */
export function buildLanes(categories: readonly Category[], rows: readonly Tx[]): Lane[] {
  const out: Lane[] = [];
  for (const type of ['income', 'expense'] as const) {
    const known = categories
      .filter((c) => c.type === type)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => c.name);
    const seen = new Set(known);
    const extra = [...new Set(rows.filter((t) => t.type === type && !seen.has(t.category)).map((t) => t.category))].sort((a, b) =>
      a.localeCompare(b, 'ko'),
    );
    for (const category of [...known, ...extra]) out.push({ type, category });
  }
  return out;
}

/** 내역을 열(날짜 또는 달) × 줄(구분+분류) 칸으로 합산한다. 열 밖의 내역은 무시한다. */
export function buildGrid(mode: DashMode, rows: readonly Tx[], columns: readonly Column[], lanes: readonly Lane[]): Grid {
  const keyLen = mode === 'days' ? 10 : 7;
  const colIndex = new Map(columns.map((c, i) => [c.key, i]));
  const laneIndex = new Map(lanes.map((l, i) => [`${l.type}\u0000${l.category}`, i]));
  const cells = new Map<string, Cell>();
  let income = 0;
  let expense = 0;

  const sorted = [...rows].sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : a.occurred_on > b.occurred_on ? 1 : 0));
  for (const t of sorted) {
    const col = colIndex.get(t.occurred_on.slice(0, keyLen));
    const lane = laneIndex.get(`${t.type}\u0000${t.category}`);
    if (col === undefined || lane === undefined) continue;
    const id = `${col}:${lane}`;
    let cell = cells.get(id);
    if (!cell) {
      cell = { col, lane, total: 0, rows: [] };
      cells.set(id, cell);
    }
    cell.total += t.amount;
    cell.rows.push(t);
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;
  }

  const list = [...cells.values()].sort((a, b) => a.col - b.col || a.lane - b.lane);
  const top = list.reduce((m, c) => Math.max(m, c.total), 0);
  return { mode, columns: [...columns], lanes: [...lanes], cells: list, max: niceMax(top), income, expense };
}

/** 금액을 0~1 높이 비율로 바꾼다. */
export function heightRatio(value: number, max: number, scale: HeightScale): number {
  if (max <= 0 || value <= 0) return 0;
  const r = Math.min(value / max, 1);
  return scale === 'sqrt' ? Math.sqrt(r) : r;
}

/**
 * 높이 축 눈금 값. 어느 축척이든 눈금이 높이 1/4, 1/2, 3/4, 1 근처에 오도록 고른다.
 * (sqrt 축척에서 1/16, 1/4, 9/16, 1배 금액이 각각 높이 1/4, 1/2, 3/4, 1이 된다.)
 */
export function heightTicks(max: number, scale: HeightScale): number[] {
  const fr = scale === 'sqrt' ? [1 / 16, 1 / 4, 9 / 16, 1] : [1 / 4, 1 / 2, 3 / 4, 1];
  return fr.map((f) => max * f);
}

/** 눈금용 금액: 1.5억, 250만, 62.5만, 8,000. 만 단위 아래 자리는 소수 한 자리까지만 남긴다. */
export function tickLabel(n: number): string {
  const one = (v: number): string => String(Math.round(v * 10) / 10);
  if (n >= 100_000_000) return `${one(n / 100_000_000)}억`;
  if (n >= 10_000) {
    const v = Math.round((n / 10_000) * 10) / 10;
    return `${Number.isInteger(v) ? v.toLocaleString('ko-KR') : v}만`;
  }
  return Math.round(n).toLocaleString('ko-KR');
}

/** 대시보드가 불러올 기간 [from, to): 기준 달로 끝나는 최근 n개월 */
export function windowRange(end: string, n = 12): [string, string] {
  const months = lastMonths(end, n);
  const [y, m] = end.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  return [`${months[0]}-01`, `${next}-01`];
}

/** 지출이 가장 큰 분류. 지출이 없으면 null */
export function topExpenseLane(grid: Grid): { category: string; total: number } | null {
  const totals = new Map<number, number>();
  for (const c of grid.cells) {
    if (grid.lanes[c.lane].type === 'expense') totals.set(c.lane, (totals.get(c.lane) ?? 0) + c.total);
  }
  let best: { category: string; total: number } | null = null;
  for (const [lane, total] of totals) {
    if (!best || total > best.total) best = { category: grid.lanes[lane].category, total };
  }
  return best;
}
