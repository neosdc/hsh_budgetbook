import { supabase } from './supabase';
import { DEFAULT_CATEGORIES, type Budget, type Category, type Tx, type TxInput, type TxType } from './types';
import { monthRange } from './util/dates';
import { buildSearchFilter } from './util/search';

const COLUMNS = 'id,type,amount,occurred_on,category,memo,created_at';

/** 해당 월(YYYY-MM)의 내역을 가져온다. 접근 범위는 RLS가 로그인 사용자 본인 행으로 제한한다. */
export async function fetchMonth(month: string): Promise<Tx[]> {
  const [from, to] = monthRange(month);
  const { data, error } = await supabase
    .from('transactions')
    .select(COLUMNS)
    .gte('occurred_on', from)
    .lt('occurred_on', to)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Tx[];
}

/** 검색 결과로 가져오는 최대 건수 */
export const SEARCH_LIMIT = 200;

/** 전체 기간에서 메모·분류·금액으로 검색한다. 최신 날짜 순이며 SEARCH_LIMIT건을 넘으면 truncated가 true다. */
export async function searchTx(term: string): Promise<{ rows: Tx[]; truncated: boolean }> {
  const filter = buildSearchFilter(term);
  if (!filter) return { rows: [], truncated: false };
  const { data, error } = await supabase
    .from('transactions')
    .select(COLUMNS)
    .or(filter)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(SEARCH_LIMIT + 1);
  if (error) throw error;
  const rows = (data ?? []) as Tx[];
  return { rows: rows.slice(0, SEARCH_LIMIT), truncated: rows.length > SEARCH_LIMIT };
}

/** 전체 기간의 모든 내역(백업/내보내기용). 한 번에 1000건 제한이 있어 나눠서 가져온다. */
export async function fetchAll(): Promise<Tx[]> {
  const PAGE = 1000;
  const out: Tx[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('transactions')
      .select(COLUMNS)
      .order('occurred_on', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as Tx[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/** id가 없으면 새로 등록하고, 있으면 수정한다. */
export async function saveTx(id: string | null, input: TxInput): Promise<void> {
  if (id === null) {
    const { error } = await supabase.from('transactions').insert(input);
    if (error) throw error;
    return;
  }
  const { data, error } = await supabase.from('transactions').update(input).eq('id', id).select('id');
  if (error) throw error;
  // RLS에 막히거나 이미 삭제된 행이면 오류 없이 0건이 갱신된다.
  if (!data || data.length === 0) throw new Error('not_found');
}

export async function removeTx(id: string): Promise<void> {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}

/* ---------- 분류 ---------- */

const CATEGORY_COLUMNS = 'id,type,name,sort_order';

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select(CATEGORY_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Category[];
}

/** 처음 쓰는 계정에 기본 분류를 채운다. 두 탭에서 동시에 실행해도 중복되지 않는다(이미 있으면 건너뜀). */
export async function seedDefaultCategories(): Promise<void> {
  const rows = (['expense', 'income'] as const).flatMap((type) =>
    DEFAULT_CATEGORIES[type].map((name, sort_order) => ({ type, name, sort_order })),
  );
  const { error } = await supabase
    .from('categories')
    .upsert(rows, { onConflict: 'user_id,type,name', ignoreDuplicates: true });
  if (error) throw error;
}

export async function addCategory(type: TxType, name: string, sortOrder: number): Promise<void> {
  const { error } = await supabase.from('categories').insert({ type, name, sort_order: sortOrder });
  if (error) throw error;
}

/** 분류 이름과, 그 분류로 기록된 모든 내역의 분류를 한 트랜잭션으로 바꾼다. */
export async function renameCategory(type: TxType, from: string, to: string): Promise<void> {
  const { error } = await supabase.rpc('rename_category', { p_type: type, p_old: from, p_new: to });
  if (error) throw error;
}

/** 분류만 지운다. 그 분류로 기록된 내역은 그대로 남는다. */
export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
}

export async function setCategoryOrder(changes: readonly { id: string; sort_order: number }[]): Promise<void> {
  for (const c of changes) {
    const { error } = await supabase.from('categories').update({ sort_order: c.sort_order }).eq('id', c.id);
    if (error) throw error;
  }
}

/* ---------- 예산 ---------- */

export async function fetchBudgets(): Promise<Budget[]> {
  const { data, error } = await supabase.from('budgets').select('id,category,amount');
  if (error) throw error;
  return (data ?? []) as Budget[];
}

/** 예산을 추가/수정(분류별로 하나)하고, 지울 예산을 삭제한다. */
export async function saveBudgets(changes: {
  upserts: readonly { category: string; amount: number }[];
  deletes: readonly string[];
}): Promise<void> {
  if (changes.upserts.length > 0) {
    const rows = changes.upserts.map((u) => ({ ...u, updated_at: new Date().toISOString() }));
    const { error } = await supabase.from('budgets').upsert(rows, { onConflict: 'user_id,category' });
    if (error) throw error;
  }
  if (changes.deletes.length > 0) {
    const { error } = await supabase.from('budgets').delete().in('category', [...changes.deletes]);
    if (error) throw error;
  }
}
