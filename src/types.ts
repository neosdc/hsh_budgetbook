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

/** 사용자 정의 분류 한 행 (public.categories) */
export interface Category {
  id: string;
  type: TxType;
  name: string;
  sort_order: number;
}

/** 월 예산 한 행 (public.budgets). category가 빈 문자열이면 전체 지출 예산이다. */
export interface Budget {
  id: string;
  category: string;
  amount: number;
}

/** 처음 쓰는 계정에 채워 주는 기본 분류. 분류 목록을 불러오지 못할 때의 대체 목록이기도 하다. */
export const DEFAULT_CATEGORIES: Record<TxType, readonly string[]> = {
  expense: ['식비', '카페·간식', '교통', '주거·통신', '쇼핑', '의료·건강', '문화·여가', '교육', '경조사', '기타'],
  income: ['급여', '부수입', '용돈', '기타'],
};
