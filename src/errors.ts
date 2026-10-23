/** Supabase/네트워크 오류를 사용자에게 보여 줄 한국어 문장으로 바꾼다. */
export function describeError(e: unknown, action: '저장' | '삭제' | '불러오기'): string {
  const err = e as { code?: string; message?: string; status?: number } | null;
  const code = err?.code ?? '';
  const message = err?.message ?? '';

  if (err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message)) {
    return action === '불러오기'
      ? '서버에 연결하지 못했습니다. 네트워크를 확인하세요. Supabase 프로젝트가 일시 중지되었다면 대시보드에서 복구해야 합니다.'
      : '서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.';
  }
  if (code === '23505') return '이미 있는 분류입니다.';
  if (code === 'P0002' || message === 'category_not_found') return '분류를 찾을 수 없습니다. 목록을 새로 불러오세요.';
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202') {
    return '이 기능을 사용할 수 없습니다. 데이터베이스 설정(마이그레이션)이 아직 적용되지 않았을 수 있습니다.';
  }
  if (message === 'not_found') return '내역을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.';
  if (code === 'PGRST301' || /jwt/i.test(message) || err?.status === 401) {
    return '로그인이 만료되었습니다. 다시 로그인하세요.';
  }
  if (code === '42501') return '이 계정에는 권한이 없습니다. 다시 로그인하세요.';
  if (code === '23514' || code === '22P02' || code === '22007') return '입력값이 올바르지 않습니다. 금액과 날짜를 확인하세요.';
  return `${action}하지 못했습니다. 잠시 후 다시 시도하세요.`;
}
