import { supabase } from './supabase';
import type { Tx, TxInput } from './types';
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
