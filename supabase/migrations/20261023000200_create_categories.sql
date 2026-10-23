-- 사용자 정의 분류.
-- transactions.category는 지금처럼 분류 "이름"을 그대로 저장한다. 그래서 기존 내역은 변환이 필요 없고,
-- 분류를 삭제해도 그 분류로 기록된 내역은 그대로 남는다. 이 테이블은 입력할 때 고를 수 있는 목록이다.

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type       text not null check (type in ('expense', 'income')),
  name       text not null check (char_length(name) between 1 and 20 and name = btrim(name)),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, type, name)
);

alter table public.categories enable row level security;

drop policy if exists "own rows" on public.categories;
create policy "own rows" on public.categories
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- transactions와 같은 최소 권한 원칙: anon은 접근 불가, authenticated는 CRUD만.
revoke all on public.categories from anon;
revoke truncate, references, trigger on public.categories from authenticated;

-- 분류 이름 변경과 그 분류로 기록된 내역의 이름 갱신을 한 트랜잭션으로 처리한다.
-- security invoker이므로 RLS가 그대로 적용되어 로그인한 사용자 본인의 행만 바뀐다.
create or replace function public.rename_category(p_type text, p_old text, p_new text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.categories
     set name = p_new
   where type = p_type and name = p_old;

  if not found then
    raise exception 'category_not_found' using errcode = 'P0002';
  end if;

  update public.transactions
     set category = p_new
   where type = p_type and category = p_old;
end;
$$;

revoke execute on function public.rename_category(text, text, text) from public, anon;
grant execute on function public.rename_category(text, text, text) to authenticated;
