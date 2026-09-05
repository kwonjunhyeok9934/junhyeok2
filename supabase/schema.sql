-- 부부 앱 1차 스키마.
-- Supabase 대시보드 → SQL Editor 에 전체를 붙여 한 번 실행한다.
-- 다시 실행하면 "already exists" 오류가 나는 것이 정상이다 (이미 만들어졌다는 뜻).
--
-- 실행 후 반드시: Authentication → Sign In / Up → "Allow new users to sign up" 을 끈다.
-- 이걸 끄지 않으면 누구나 계정을 만들어 들어올 수 있다.

-- 1. 표 -----------------------------------------------------------------

create table profiles (
  id    uuid primary key references auth.users(id) on delete cascade,
  name  text not null,
  color text not null default '#3b82f6'
);

create table categories (
  id         bigint generated always as identity primary key,
  name       text not null,
  kind       text not null check (kind in ('expense', 'income')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table transactions (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('expense', 'income')),
  amount      integer not null check (amount > 0),
  category_id bigint references categories(id) on delete set null,
  date        date not null,
  memo        text not null default '',
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);

create index transactions_date_idx on transactions (date);

-- 2. 접근 제어: 로그인한 사용자는 모든 행을 읽고 쓸 수 있다 ------------------

alter table profiles     enable row level security;
alter table categories   enable row level security;
alter table transactions enable row level security;

create policy "auth all" on profiles     for all to authenticated using (true) with check (true);
create policy "auth all" on categories   for all to authenticated using (true) with check (true);
create policy "auth all" on transactions for all to authenticated using (true) with check (true);

-- 3. 계정이 생기면 profiles 행 자동 생성 -------------------------------------

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 4. 실시간 -------------------------------------------------------------------

alter publication supabase_realtime add table transactions, categories;

-- 5. 기본 카테고리 (앱에서 언제든 바꿀 수 있다) ---------------------------------

insert into categories (name, kind, sort_order) values
  ('식비',        'expense', 10),
  ('외식',        'expense', 20),
  ('카페',        'expense', 30),
  ('교통',        'expense', 40),
  ('생활',        'expense', 50),
  ('주거/공과금', 'expense', 60),
  ('의료',        'expense', 70),
  ('쇼핑',        'expense', 80),
  ('여가',        'expense', 90),
  ('기타',        'expense', 100),
  ('월급',        'income',  10),
  ('용돈',        'income',  20),
  ('기타',        'income',  30);
