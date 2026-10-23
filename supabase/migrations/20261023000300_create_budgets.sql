-- 지출 예산. 매달 같은 금액이 적용되는 "월 예산"이다.
-- category = '' 이면 그 달 전체 지출에 대한 예산이고, 그 외에는 해당 지출 분류(이름)의 예산이다.
-- 분류는 transactions와 마찬가지로 이름 문자열로 저장한다.

create table if not exists public.budgets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category   text not null default '' check (char_length(category) <= 20 and category = btrim(category)),
  amount     bigint not null check (amount between 1 and 10000000000000),
  updated_at timestamptz not null default now(),
  unique (user_id, category)
);

alter table public.budgets enable row level security;

drop policy if exists "own rows" on public.budgets;
create policy "own rows" on public.budgets
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.budgets from anon;
revoke truncate, references, trigger on public.budgets from authenticated;

-- 지출 분류의 이름을 바꾸면 그 분류의 예산도 새 이름을 따라가도록 rename_category를 확장한다.
-- (이전 버전은 categories와 transactions만 바꿨다.)
-- 새 이름으로 남아 있던 옛 예산(이미 삭제된 같은 이름 분류의 것)이 있으면 지우고 이쪽 예산을 우선한다.
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

  if p_type = 'expense' then
    delete from public.budgets
     where category = p_new
       and exists (select 1 from public.budgets b where b.category = p_old and b.user_id = public.budgets.user_id);

    update public.budgets
       set category = p_new, updated_at = now()
     where category = p_old;
  end if;
end;
$$;

revoke execute on function public.rename_category(text, text, text) from public, anon;
grant execute on function public.rename_category(text, text, text) to authenticated;
