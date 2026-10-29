import type { Tx } from '../types';
import { PERSONS, resolvePlace, type Place } from './places';

/*
 * 대시보드 원형(도넛) 그래프용 집계.
 *   인원별: 내역의 위치·사람 값으로 그 지출을 누구 몫으로 셀지 정한다(PLACE_PEOPLE).
 *     사람 이름이면 그 사람, 위치면 그 위치를 쓰는 사람들이 똑같이 나눠 가진다. 비어 있으면 거실과 같다.
 *   분류별: 금액이 큰 분류 MAX_CATEGORY_SLICES개, 나머지는 "그 외 n개 분류" 한 조각으로 묶는다
 * 조각이 많으면 색으로 구분하기 어려워(색약 포함) 조각 수를 제한한다.
 */

/** 분류 그래프에서 따로 보여 줄 최대 분류 수(나머지는 한 조각으로 묶음) */
export const MAX_CATEGORY_SLICES = 5;

/** 위치 → 그 위치의 지출을 나눠 가질 사람들. 순서는 PERSONS 순서(나머지 원 단위를 앞사람부터 준다). */
export const PLACE_PEOPLE: Readonly<Record<Place, readonly string[]>> = {
  거실: PERSONS,
  현관: PERSONS,
  부엌: PERSONS,
  안방: ['승영', '지혜'],
  윤지방: ['윤지', '윤솔'],
  드레스룸: ['지혜'],
  서재: ['승영'],
};

export interface Slice {
  /** 조각 이름(사람 이름, 분류 이름, '그 외 n개 분류') */
  key: string;
  total: number;
  /** 0~1 */
  ratio: number;
  /** 조각에 속한 지출(날짜 오름차순) */
  rows: Tx[];
  /** rows[i] 중 이 조각에 들어간 금액. 인원별에서 여러 사람이 나눈 지출은 몫만 들어간다. */
  shares: number[];
  /** rows[i]를 몇 명이 나눴는지(인원별). 1이면 혼자 몫 */
  splits: number[];
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

/**
 * 이 지출을 나눠 가질 사람들. 사람 이름이면 그 사람 한 명, 위치(또는 빈 값 = 거실, 목록에 없는 값 = 거실)면 PLACE_PEOPLE.
 */
export function peopleOf(t: Tx): readonly string[] {
  const r = resolvePlace(t.place);
  return r.kind === 'person' ? [t.place.trim()] : PLACE_PEOPLE[r.place];
}

/** 원 단위로 n명에게 나눈다. 나누어떨어지지 않는 나머지는 앞사람부터 1원씩 더 준다(합계가 원래 금액과 같다). */
export function splitAmount(amount: number, n: number): number[] {
  const base = Math.floor(amount / n);
  const rem = amount - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

/**
 * 인원별 지출. 순서는 사람 목록 순서(승영, 지혜, 윤지, 윤솔)로 고정한다.
 * 그래서 달이 바뀌어도 같은 사람은 같은 자리·같은 색이다. 금액이 0인 사람은 뺀다.
 * 모든 지출이 누군가에게 나뉘므로 조각 합계는 지출 합계와 같다.
 */
export function slicesByPerson(rows: readonly Tx[]): Slice[] {
  const expenses = expensesSorted(rows);
  const acc = new Map(PERSONS.map((k) => [k, { rows: [] as Tx[], shares: [] as number[], splits: [] as number[] }]));
  for (const t of expenses) {
    const people = peopleOf(t);
    splitAmount(t.amount, people.length).forEach((share, i) => {
      const a = acc.get(people[i])!;
      a.rows.push(t);
      a.shares.push(share);
      a.splits.push(people.length);
    });
  }
  const total = expenses.reduce((a, t) => a + t.amount, 0);
  const list = [...acc.entries()]
    .map(([key, a]) => ({ key, ...a, total: a.shares.reduce((x, y) => x + y, 0), rest: false }))
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
    .map(([key, list]) => ({
      key,
      rows: list,
      shares: list.map((t) => t.amount),
      splits: list.map(() => 1),
      total: list.reduce((a, t) => a + t.amount, 0),
      rest: false,
    }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key, 'ko'));
  if (all.length <= max + 1) return finish(all, total);
  const head = all.slice(0, max);
  const tail = all.slice(max);
  const restRows = expensesSorted(tail.flatMap((s) => s.rows));
  const rest = {
    key: `그 외 ${tail.length}개 분류`,
    rows: restRows,
    shares: restRows.map((t) => t.amount),
    splits: restRows.map(() => 1),
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
