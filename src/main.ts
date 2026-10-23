import './style.css';
import type { Session } from '@supabase/supabase-js';
import { consumeAuthError, signInWithGoogle, signOut } from './auth';
import { $, toast } from './dom';
import { Ledger } from './ledger';
import { supabase } from './supabase';

type View = 'boot' | 'login' | 'app';

function showView(view: View): void {
  $('boot').hidden = view !== 'boot';
  $('login-view').hidden = view !== 'login';
  $('app-view').hidden = view !== 'app';
}

function showLoginError(message: string): void {
  const el = $('login-error');
  el.textContent = message;
  el.hidden = message === '';
}

/** PKCE 로그인 후 주소에 남는 ?code= 를 지운다. */
function stripAuthCode(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('code')) return;
  url.searchParams.delete('code');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

async function main(): Promise<void> {
  const ledger = new Ledger();
  // undefined는 "아직 한 번도 화면을 정하지 않음"을 뜻한다. 로그아웃 상태(null)와 구분해야 첫 로그인 화면이 뜬다.
  let currentUserId: string | null | undefined;

  function applySession(session: Session | null): void {
    const userId = session?.user.id ?? null;
    // 탭을 다시 열 때도 SIGNED_IN 이벤트가 오므로, 같은 사용자면 다시 시작하지 않는다.
    if (userId === currentUserId) return;
    currentUserId = userId;
    if (session) {
      showView('app');
      ledger.start(session.user.email ?? '');
    } else {
      ledger.stop();
      showView('login');
    }
  }

  const authError = consumeAuthError();

  $('login-btn').addEventListener('click', async () => {
    const button = $<HTMLButtonElement>('login-btn');
    button.disabled = true;
    showLoginError('');
    try {
      await signInWithGoogle();
    } catch {
      button.disabled = false;
      showLoginError('로그인을 시작하지 못했습니다. 잠시 후 다시 시도하세요.');
    }
  });

  $('logout-btn').addEventListener('click', async () => {
    try {
      await signOut();
    } catch {
      toast('로그아웃하지 못했습니다. 잠시 후 다시 시도하세요.');
    }
  });

  // 콜백 안에서 Supabase를 바로 호출하면 교착될 수 있어 다음 틱으로 넘긴다.
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => applySession(session), 0);
  });

  const { data } = await supabase.auth.getSession();
  stripAuthCode();
  if (authError) showLoginError(authError);
  applySession(data.session);
}

main().catch(() => {
  $('boot').textContent = '앱을 시작하지 못했습니다. 페이지를 새로 고쳐 주세요.';
});
