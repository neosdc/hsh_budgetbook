import type { Budget, Tx } from '../types';

/** budgets.category가 이 값이면 그 달 전체 지출 예산이다. */
export const OVERALL = '';

export const BUDGET_MAX = 10_000_000_000_000;

export type BudgetState = 'ok' | 'warn' | 'over';

export interface BudgetStatus {
  /** OVERALL 또는 분류 이름 */
  key: string;
  budget: number;
  spent: number;
  /** 예산 - 지출. 초과하면 음수 */
  remaining: number;
  /** 지출 / 예산 (1 = 100%) */
  ratio: number;
  state: BudgetState;
}

/**
 * 예산 대비 지출 상태. 예산을 넘으면 over, 예산의 80% 이상이면 warn(경고), 그 밖에는 ok.
 * 예산과 정확히 같은 금액은 아직 초과가 아니다. 부동소수점 오차가 없도록 정수끼리 비교한다.
 */
export function budgetState(spent: number, budget: number): BudgetState {
  if (spent > budget) return 'over';
  if (spent * 5 >= budget * 4) return 'warn';
  return 'ok';
}

/**
 * 한 달치 내역에서 예산별 현황을 계산한다. 전체 예산이 맨 앞이고, 분류 예산은 `order`(분류 목록 순서)를 따르며
 * 목록에 없는 분류(삭제된 분류)의 예산은 뒤에 이름순으로 붙는다. 수입은 계산에 넣지 않는다.
 */
export function budgetStatuses(
  budgets: readonly Budget[],
  rows: readonly Tx[],
  order: readonly string[] = [],
): BudgetStatus[] {
  const byCategory = new Map<string, number>();
  let total = 0;
  for (const t of rows) {
    if (t.type !== 'expense') continue;
    total += t.amount;
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
  }
  const rank = (key: string): number => {
    if (key === OVERALL) return -1;
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
  };
  return [...budgets]
    .sort((a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category, 'ko'))
    .map((b) => {
      const spent = b.category === OVERALL ? total : (byCategory.get(b.category) ?? 0);
      return {
        key: b.category,
        budget: b.amount,
        spent,
        remaining: b.amount - spent,
        ratio: spent / b.amount,
        state: budgetState(spent, b.amount),
      };
    });
}

const SEVERITY: Record<BudgetState, number> = { ok: 0, warn: 1, over: 2 };

/** 이전 현황보다 상태가 나빠진(ok→warn, ok/warn→over) 항목. 더 심각한 것이 앞에 온다. */
export function worsened(before: readonly BudgetStatus[], after: readonly BudgetStatus[]): BudgetStatus[] {
  const prev = new Map(before.map((s) => [s.key, s.state]));
  return after
    .filter((s) => SEVERITY[s.state] > SEVERITY[prev.get(s.key) ?? 'ok'])
    .sort((a, b) => SEVERITY[b.state] - SEVERITY[a.state]);
}

/** 예산 입력창 문자열을 금액으로 바꾼다. 비었거나 0이면 null(예산 없음). */
export function parseBudgetInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (digits === '') return null;
  if (digits.length > 14) return Number.POSITIVE_INFINITY;
  return Number(digits);
}

export interface BudgetEdit {
  /** 입력창의 분류 키(OVERALL 또는 분류 이름) */
  key: string;
  /** 입력값. null이면 예산 없음 */
  amount: number | null;
}

export interface BudgetChanges {
  upserts: { category: string; amount: number }[];
  deletes: string[];
}

/** 현재 저장된 예산과 입력값을 비교해, 서버에 반영해야 하는 추가/수정/삭제만 골라 낸다. */
export function diffBudgets(current: readonly Budget[], edits: readonly BudgetEdit[]): BudgetChanges {
  const now = new Map(current.map((b) => [b.category, b.amount]));
  const changes: BudgetChanges = { upserts: [], deletes: [] };
  for (const e of edits) {
    const had = now.get(e.key);
    if (e.amount === null) {
      if (had !== undefined) changes.deletes.push(e.key);
    } else if (had !== e.amount) {
      changes.upserts.push({ category: e.key, amount: e.amount });
    }
  }
  return changes;
}
