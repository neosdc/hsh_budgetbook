import type { Tx } from '../types';

/*
 * 내역의 "위치·사람"(transactions.place, recurring_rules.place).
 * 집 안의 위치 이름 또는 가족 이름을 저장하고, 3D 대시보드의 "우리 집" 보기에서 막대를 세울 자리를 정한다.
 *   사람 이름  → 그 사람의 자리(승영 → 서재, 윤지·윤솔 → 윤지방, 지혜 → 드레스룸)
 *   위치 이름  → 그 자리
 *   빈 값      → 거실
 * 값은 입력 화면에서 목록으로만 고르고, DB의 check 제약도 같은 목록만 허용한다
 * (supabase/migrations/20261026000000_add_place.sql). 목록을 바꿀 때는 두 곳을 함께 고친다.
 */

/** 위치(막대를 세우는 자리). 배열 순서가 입력 목록의 순서다. */
export const PLACES = ['거실', '부엌', '서재', '안방', '윤지방', '드레스룸', '현관'] as const;
export type Place = (typeof PLACES)[number];

/** 사람 → 그 사람의 자리. 객체 순서가 입력 목록의 순서다. */
export const PERSON_PLACE: Readonly<Record<string, Place>> = {
  '승영': '서재',
  '지혜': '드레스룸',
  '윤지': '윤지방',
  '윤솔': '윤지방',
};
export const PERSONS = Object.keys(PERSON_PLACE);

/** 값이 비어 있을 때의 자리 */
export const DEFAULT_PLACE: Place = '거실';

export type PlaceKind = 'empty' | 'person' | 'place' | 'unknown';

export interface Resolved {
  place: Place;
  kind: PlaceKind;
}

const PLACE_SET = new Set<string>(PLACES);

/** 저장된 위치·사람 값을 막대를 세울 자리로 바꾼다. 목록에 없는 값(옛 데이터 등)은 거실로 보내고 unknown으로 표시한다. */
export function resolvePlace(raw: string | null | undefined): Resolved {
  const v = (raw ?? '').trim();
  if (v === '') return { place: DEFAULT_PLACE, kind: 'empty' };
  const person = PERSON_PLACE[v];
  if (person) return { place: person, kind: 'person' };
  if (PLACE_SET.has(v)) return { place: v as Place, kind: 'place' };
  return { place: DEFAULT_PLACE, kind: 'unknown' };
}

/** 입력 목록에서 고를 수 있는 값인지(빈 값 포함) */
export function isPlaceValue(v: string): boolean {
  return v === '' || v in PERSON_PLACE || PLACE_SET.has(v);
}

/** 내역 목록 등에 짧게 쓸 설명: '윤지 · 윤지방', '부엌', 빈 값이면 '' */
export function placeLabel(raw: string | null | undefined): string {
  const r = resolvePlace(raw);
  if (r.kind === 'empty') return '';
  if (r.kind === 'person') return `${(raw ?? '').trim()} · ${r.place}`;
  return (raw ?? '').trim();
}

/** 입력 select의 옵션 HTML. 목록에 없는 기존 값이 있으면 그 값도 남겨 둔다(저장하면 사라지지 않게). */
export function placeOptionsHtml(selected: string, esc: (s: string) => string): string {
  const opt = (v: string, label: string): string => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(label)}</option>`;
  const legacy = selected !== '' && !isPlaceValue(selected) ? opt(selected, `${selected} (목록에 없는 값)`) : '';
  return (
    opt('', `선택 안 함 (${DEFAULT_PLACE})`) +
    `<optgroup label="사람">${PERSONS.map((p) => opt(p, p)).join('')}</optgroup>` +
    `<optgroup label="위치">${PLACES.map((p) => opt(p, p)).join('')}</optgroup>` +
    legacy
  );
}

export interface PlaceGroup {
  place: Place;
  category: string;
  total: number;
  /** 날짜 오름차순 */
  rows: Tx[];
}

/** 지출을 자리 × 분류로 묶는다. 자리별로 금액이 큰 분류부터 정렬한다. 수입은 무시한다. */
export function groupByPlace(rows: readonly Tx[]): Map<Place, PlaceGroup[]> {
  const byKey = new Map<string, PlaceGroup>();
  const sorted = [...rows].sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : a.occurred_on > b.occurred_on ? 1 : 0));
  for (const t of sorted) {
    if (t.type !== 'expense') continue;
    const place = resolvePlace(t.place).place;
    const key = `${place}\u0000${t.category}`;
    let g = byKey.get(key);
    if (!g) {
      g = { place, category: t.category, total: 0, rows: [] };
      byKey.set(key, g);
    }
    g.total += t.amount;
    g.rows.push(t);
  }
  const out = new Map<Place, PlaceGroup[]>(PLACES.map((p) => [p, []]));
  for (const g of byKey.values()) out.get(g.place)!.push(g);
  for (const list of out.values()) list.sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, 'ko'));
  return out;
}

/** 비율 표시: 소수 한 자리(예: 77.7%). 전체가 0이면 0.0% */
export function percentLabel(part: number, whole: number): string {
  return `${whole > 0 ? ((part / whole) * 100).toFixed(1) : '0.0'}%`;
}
