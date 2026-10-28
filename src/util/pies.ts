import type { Tx } from '../types';
import { PERSONS, resolvePlace } from './places';

/*
 * 대시보드 원형(도넛) 그래프용 집계.
 *   인원별: 내역의 위치·사람 값이 사람 이름이면 그 사람, 그 밖(위치 이름·빈 값)은 "가족 공동"
 *   분류별: 금액이 큰 분류 MAX_CATEGORY_SLICES개, 나머지는 "그 외 n개 분류" 한 조각으로 묶는다
 * 조각이 많으면 색으로 구분하기 어려워(색약 포함) 조각 수를 제한한다.
 */

export const SHARED = '가족 공동';
/** 분류 그래프에서 따로 보여 줄 최대 분류 수(나머지는 한 조각으로 묶음) */
export const MAX_CATEGORY_SLICES = 5;

export interface Slice {
  /** 조각 이름(사람 이름, 분류 이름, '가족 공동', '그 외 n개 분류') */
  key: string;
  total: number;
  /** 0~1 */
  ratio: number;
  /** 조각에 속한 지출(날짜 오름차순) */
  rows: Tx[];
  /** 남는 것들을 묶은 조각(색을 회색으로 칠한다) */
  rest: boolean;
  /** 묶은 조각에 들어간 분류 이름들 */
  members?: string[];
}

function expensesSorted(rows: readonly Tx[]): Tx[] {
  return rows
    .filter((t) => t.type === 'expense')
    .sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : a.occurred_on > b.occurred_on ? 1 : a.created_at < b.created_at ? -1 : 1));
}

function finish(list: Omit<Slice, 'ratio'>[], total: number): Slice[] {
  return list.map((s) => ({ ...s, ratio: total > 0 ? s.total / total : 0 }));
}

/** 사람(가족 4명) 이름. 위치·사람 값이 이 중 하나면 그 사람의 지출로 센다. */
export function personOf(t: Tx): string {
  return resolvePlace(t.place).kind === 'person' ? t.place.trim() : SHARED;
}

/**
 * 인원별 지출. 순서는 사람 목록 순서(승영, 지혜, 윤지, 윤솔) 다음 가족 공동으로 고정한다.
 * 그래서 달이 바뀌어도 같은 사람은 같은 자리·같은 색이다. 금액이 0인 사람은 뺀다.
 */
export function slicesByPerson(rows: readonly Tx[]): Slice[] {
  const expenses = expensesSorted(rows);
  const map = new Map<string, Tx[]>([...PERSONS, SHARED].map((k) => [k, []]));
  for (const t of expenses) map.get(personOf(t))!.push(t);
  const total = expenses.reduce((a, t) => a + t.amount, 0);
  const list = [...map.entries()]
    .map(([key, list]) => ({ key, rows: list, total: list.reduce((a, t) => a + t.amount, 0), rest: key === SHARED }))
    .filter((s) => s.total > 0);
  return finish(list, total);
}

/** 분류별 지출. 금액이 큰 순서로 max개, 나머지는 한 조각으로 묶는다(나머지가 한 분류뿐이면 그대로 둔다). */
export function slicesByCategory(rows: readonly Tx[], max = MAX_CATEGORY_SLICES): Slice[] {
  const expenses = expensesSorted(rows);
  const map = new Map<string, Tx[]>();
  for (const t of expenses) {
    const list = map.get(t.category) ?? [];
    list.push(t);
    map.set(t.category, list);
  }
  const total = expenses.reduce((a, t) => a + t.amount, 0);
  const all = [...map.entries()]
    .map(([key, list]) => ({ key, rows: list, total: list.reduce((a, t) => a + t.amount, 0), rest: false }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key, 'ko'));
  if (all.length <= max + 1) return finish(all, total);
  const head = all.slice(0, max);
  const tail = all.slice(max);
  const rest = {
    key: `그 외 ${tail.length}개 분류`,
    rows: expensesSorted(tail.flatMap((s) => s.rows)),
    total: tail.reduce((a, s) => a + s.total, 0),
    rest: true,
    members: tail.map((s) => s.key),
  };
  return finish([...head, rest], total);
}

/* ---------- 도넛 조각 경로 ---------- */

export interface Arc {
  /** SVG path d */
  d: string;
  /** 조각 가운데 각도(라디안, 12시 방향이 0, 시계 방향) */
  mid: number;
}

const point = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/**
 * 12시 방향부터 시계 방향으로 도넛 조각 경로를 만든다.
 * 조각 사이에는 바깥 둘레 기준 gap 길이만큼 틈을 둔다(조각이 하나면 틈 없이 고리 전체).
 */
export function donutArcs(ratios: readonly number[], cx: number, cy: number, rOuter: number, rInner: number, gap = 2): Arc[] {
  const total = ratios.reduce((a, r) => a + r, 0);
  if (total <= 0) return [];
  const live = ratios.filter((r) => r > 0).length;
  const out: Arc[] = [];
  let start = 0;
  for (const r of ratios) {
    const sweep = (r / total) * Math.PI * 2;
    const a0 = start;
    const a1 = start + sweep;
    start = a1;
    if (sweep <= 0) {
      out.push({ d: '', mid: a0 });
      continue;
    }
    if (live === 1) {
      // 고리 전체: 반원 두 개로 그린다(시작점과 끝점이 같은 호는 그려지지 않는다).
      const [ox, oy] = point(cx, cy, rOuter, 0);
      const [px, py] = point(cx, cy, rOuter, Math.PI);
      const [ix, iy] = point(cx, cy, rInner, 0);
      const [qx, qy] = point(cx, cy, rInner, Math.PI);
      out.push({
        d:
          `M${f(ox)},${f(oy)}A${rOuter},${rOuter} 0 1 1 ${f(px)},${f(py)}A${rOuter},${rOuter} 0 1 1 ${f(ox)},${f(oy)}Z` +
          `M${f(ix)},${f(iy)}A${rInner},${rInner} 0 1 0 ${f(qx)},${f(qy)}A${rInner},${rInner} 0 1 0 ${f(ix)},${f(iy)}Z`,
        mid: Math.PI,
      });
      continue;
    }
    // 틈: 바깥 둘레와 안쪽 둘레에서 같은 길이(gap/2씩)를 깎는다. 조각이 틈보다 작으면 가운데로 모은다.
    const po = Math.min(gap / 2 / rOuter, sweep / 2 - 1e-4);
    const pi = Math.min(gap / 2 / rInner, sweep / 2 - 1e-4);
    const large = sweep - 2 * po > Math.PI ? 1 : 0;
    const largeIn = sweep - 2 * pi > Math.PI ? 1 : 0;
    const [x0, y0] = point(cx, cy, rOuter, a0 + po);
    const [x1, y1] = point(cx, cy, rOuter, a1 - po);
    const [x2, y2] = point(cx, cy, rInner, a1 - pi);
    const [x3, y3] = point(cx, cy, rInner, a0 + pi);
    out.push({
      d: `M${f(x0)},${f(y0)}A${rOuter},${rOuter} 0 ${large} 1 ${f(x1)},${f(y1)}L${f(x2)},${f(y2)}A${rInner},${rInner} 0 ${largeIn} 0 ${f(x3)},${f(y3)}Z`,
      mid: (a0 + a1) / 2,
    });
  }
  return out;
}
