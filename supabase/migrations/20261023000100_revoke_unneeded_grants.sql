-- 최소 권한 정리.
-- Supabase 기본값은 anon/authenticated에 테이블 권한을 모두 부여한다.
-- anon은 정책이 없어 행에 접근할 수 없지만 권한 자체도 회수하고,
-- authenticated에는 앱이 쓰는 CRUD 권한만 남긴다. (TRUNCATE는 RLS 대상이 아니다.)

revoke all on public.transactions from anon;
revoke truncate, references, trigger on public.transactions from authenticated;
