-- 반복 내역(월세, 구독료 등): 매달 정해진 날에 자동으로 기록되는 규칙.
-- 앱을 열 때 브라우저가 아직 기록되지 않은 회차를 transactions에 만든다.
--   - generated_through: 마지막으로 처리한 회차의 달(그 달 1일). 그 다음 달부터 만들기 때문에,
--     사용자가 자동 생성된 내역을 지워도 다시 생기지 않는다.
--   - transactions (recurring_id, recurring_period) 유일 제약: 두 기기/탭이 동시에 열려도 같은 회차가 두 번 생기지 않는다.

create table if not exists public.recurring_rules (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type           text not null check (type in ('expense', 'income')),
  amount         bigint not null check (amount between 1 and 10000000000000),
  category       text not null check (char_length(category) between 1 and 20),
  memo           text not null default '' check (char_length(memo) <= 60),
  day_of_month   smallint not null check (day_of_month between 1 and 31),
  start_date     date not null,
  end_date       date check (end_date is null or end_date >= start_date),
  generated_through date,
  created_at     timestamptz not null default now()
);

alter table public.recurring_rules enable row level security;

drop policy if exists "own rows" on public.recurring_rules;
create policy "own rows" on public.recurring_rules
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.recurring_rules from anon;
revoke truncate, references, trigger on public.recurring_rules from authenticated;

-- 규칙을 지워도 이미 만들어진 내역은 남는다(recurring_id만 비워짐).
alter table public.transactions
  add column if not exists recurring_id uuid references public.recurring_rules (id) on delete set null,
  add column if not exists recurring_period date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_recurring_unique') then
    alter table public.transactions
      add constraint transactions_recurring_unique unique (recurring_id, recurring_period);
  end if;
end $$;

-- 다른 사용자의 규칙에 내역을 연결하지 못하게 한다. (FK 검사는 RLS를 거치지 않으므로 정책에서 막는다.
-- 서브쿼리는 호출자의 RLS를 받아 본인 규칙만 보인다.)
drop policy if exists "own rows" on public.transactions;
create policy "own rows" on public.transactions
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      recurring_id is null
      or exists (select 1 from public.recurring_rules r where r.id = recurring_id)
    )
  );
