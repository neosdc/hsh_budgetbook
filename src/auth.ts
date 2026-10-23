import { supabase } from './supabase';

/** OAuth 로그인 후 돌아올 주소. GitHub Pages 하위 경로(base)를 포함한다. */
function redirectUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL;
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectUrl() },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * 로그인 실패 시 Supabase는 error, error_code, error_description을
 * 쿼리 문자열 또는 해시로 붙여 돌려보낸다. 읽은 뒤 주소창에서 지운다.
 */
export function consumeAuthError(): string | null {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const get = (k: string): string | null => url.searchParams.get(k) ?? hash.get(k);

  const code = get('error_code');
  const description = get('error_description') ?? get('error');
  if (!code && !description) return null;

  for (const k of ['error', 'error_code', 'error_description']) url.searchParams.delete(k);
  url.hash = '';
  window.history.replaceState(null, '', url.pathname + url.search);

  if (code === 'signup_disabled' || /signups? not allowed/i.test(description ?? '')) {
    return '이 가계부는 등록된 계정만 로그인할 수 있습니다.';
  }
  if (code === 'access_denied' || /access_denied/.test(description ?? '')) {
    return '로그인이 취소되었습니다.';
  }
  return '로그인하지 못했습니다. 잠시 후 다시 시도하세요.';
}
