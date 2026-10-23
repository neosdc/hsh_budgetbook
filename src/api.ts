import { supabase } from './supabase';
import type { Tx, TxInput } from './types';
import { monthRange } from './util/dates';

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
