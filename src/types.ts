export type TxType = 'expense' | 'income';

/** public.transactions 한 행 */
export interface Tx {
  id: string;
  type: TxType;
  /** 원 단위 양의 정수 */
  amount: number;
  /** YYYY-MM-DD */
  occurred_on: string;
  category: string;
  memo: string;
  created_at: string;
}

/** 등록/수정 입력값 (user_id는 DB 기본값 auth.uid()로 채워진다) */
export interface TxInput {
  type: TxType;
  amount: number;
  occurred_on: string;
  category: string;
  memo: string;
}

export const CATEGORIES: Record<TxType, readonly string[]> = {
  expense: ['식비', '카페·간식', '교통', '주거·통신', '쇼핑', '의료·건강', '문화·여가', '교육', '경조사', '기타'],
  income: ['급여', '부수입', '용돈', '기타'],
};
