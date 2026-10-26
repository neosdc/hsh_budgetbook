-- 내역과 반복 내역의 "위치·사람".
-- 집 안 위치 이름 또는 가족 이름을 저장하고, 3D 대시보드의 "우리 집" 보기에서 막대를 세울 자리를 정한다.
--   사람 이름: 승영 → 서재, 지혜 → 드레스룸, 윤지·윤솔 → 윤지방 (해석은 앱이 한다: src/util/places.ts)
--   위치 이름: 그 자리
--   빈 값: 정하지 않음(거실에 놓인다)
-- 입력 화면에서 목록으로만 고르고, 여기서도 같은 목록만 허용한다. 목록을 바꿀 때는 places.ts와 이 제약을 함께 고친다.
-- 기본값이 상수인 열 추가는 Postgres에서 테이블을 다시 쓰지 않으므로 기존 행이 많아도 바로 끝난다.

alter table public.transactions add column if not exists place text not null default '';
alter table public.recurring_rules add column if not exists place text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_place_check') then
    alter table public.transactions add constraint transactions_place_check check (
      place in ('', '승영', '지혜', '윤지', '윤솔', '거실', '부엌', '서재', '안방', '윤지방', '드레스룸', '현관')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recurring_rules_place_check') then
    alter table public.recurring_rules add constraint recurring_rules_place_check check (
      place in ('', '승영', '지혜', '윤지', '윤솔', '거실', '부엌', '서재', '안방', '윤지방', '드레스룸', '현관')
    );
  end if;
end $$;
