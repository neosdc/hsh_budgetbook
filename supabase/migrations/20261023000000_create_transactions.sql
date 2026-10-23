-- 가계부 내역 테이블.
-- 금액은 원 단위 정수(bigint)이고, 각 행은 만든 사용자(user_id)에게만 보인다.

create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type        text not null check (type in ('expense', 'income')),
  amount      bigint not null check (amount > 0),
  occurred_on date not null,
  category    text not null,
  memo        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists transactions_user_id_occurred_on_idx
  on public.transactions (user_id, occurred_on);

-- 브라우저에 공개되는 publishable key로 접근하므로 RLS가 유일한 방어선이다.
alter table public.transactions enable row level security;

drop policy if exists "own rows" on public.transactions;
create policy "own rows" on public.transactions
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
