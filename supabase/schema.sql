-- 부부 앱 1차 스키마.
-- Supabase 대시보드 → SQL Editor 에 전체를 붙여 실행한다.
-- 몇 번 실행해도 안전하다: 이미 있는 것은 건너뛰고, 없는 것만 만든다.
--
-- 실행 후 반드시: Authentication → Sign In / Providers → "Allow new users to sign up" 을 끈다.
-- 이걸 끄지 않으면 누구나 계정을 만들어 들어올 수 있다.

-- 1. 표 -----------------------------------------------------------------

create table if not exists profiles (
  id    uuid primary key references auth.users(id) on delete cascade,
  name  text not null,
  color text not null default '#3b82f6'
);

create table if not exists categories (
  id         bigint generated always as identity primary key,
  name       text not null,
  kind       text not null check (kind in ('expense', 'income', 'fixed')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('expense', 'income')),
  amount      integer not null check (amount > 0),
  category_id bigint references categories(id) on delete set null,
  date        date not null,
  memo        text not null default '',
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists transactions_date_idx on transactions (date);

-- 2. 접근 제어: 로그인한 사용자는 모든 행을 읽고 쓸 수 있다 ------------------

alter table profiles     enable row level security;
alter table categories   enable row level security;
alter table transactions enable row level security;

drop policy if exists "auth all" on profiles;
drop policy if exists "auth all" on categories;
drop policy if exists "auth all" on transactions;

create policy "auth all" on profiles     for all to authenticated using (true) with check (true);
create policy "auth all" on categories   for all to authenticated using (true) with check (true);
create policy "auth all" on transactions for all to authenticated using (true) with check (true);

-- 3. 계정이 생기면 profiles 행 자동 생성 -------------------------------------

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 이미 만들어진 계정이 있으면 profiles 행을 채워 준다.
insert into profiles (id, name)
select u.id, coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1))
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);

-- 4. 실시간 -------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'transactions') then
    alter publication supabase_realtime add table transactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'categories') then
    alter publication supabase_realtime add table categories;
  end if;
end $$;

-- 5. 기본 카테고리: 카테고리가 하나도 없을 때만 넣는다 --------------------------

insert into categories (name, kind, sort_order)
select * from (values
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
  ('기타',        'income',  30)
) as v(name, kind, sort_order)
where not exists (select 1 from categories);

-- 7. 할일 ---------------------------------------------------------------------

create table if not exists todos (
  id         bigint generated always as identity primary key,
  title      text not null,
  done       boolean not null default false,
  done_at    timestamptz,
  assignee   uuid references auth.users(id) on delete set null,
  due        date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table todos enable row level security;
drop policy if exists "auth all" on todos;
create policy "auth all" on todos for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'todos') then
    alter publication supabase_realtime add table todos;
  end if;
end $$;

-- 9. 스케줄 -------------------------------------------------------------------

create table if not exists events (
  id         bigint generated always as identity primary key,
  title      text not null,
  date       date not null,
  time       time,
  owner      uuid references auth.users(id) on delete set null,
  memo       text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists events_date_idx on events (date);

alter table events enable row level security;
drop policy if exists "auth all" on events;
create policy "auth all" on events for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'events') then
    alter publication supabase_realtime add table events;
  end if;
end $$;

-- 11. 고정비 -------------------------------------------------------------------

create table if not exists fixed_costs (
  id         bigint generated always as identity primary key,
  name       text not null,
  amount     integer not null check (amount > 0),
  memo       text not null default '',
  owner      uuid references auth.users(id) on delete set null,   -- null = 공통
  created_at timestamptz not null default now()
);
alter table fixed_costs add column if not exists owner uuid references auth.users(id) on delete set null;

alter table fixed_costs enable row level security;
drop policy if exists "auth all" on fixed_costs;
create policy "auth all" on fixed_costs for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'fixed_costs') then
    alter publication supabase_realtime add table fixed_costs;
  end if;
end $$;

-- 13. 카테고리에 고정비 종류 허용 + 기본 고정비 카테고리 -----------------------

alter table categories drop constraint if exists categories_kind_check;
alter table categories add constraint categories_kind_check check (kind in ('expense', 'income', 'fixed'));

insert into categories (name, kind, sort_order)
select * from (values
  ('월세',       'fixed', 10),
  ('관리비',     'fixed', 20),
  ('통신비',     'fixed', 30),
  ('인터넷',     'fixed', 40),
  ('실비보험',   'fixed', 50),
  ('운전자보험', 'fixed', 60),
  ('자동차보험', 'fixed', 70),
  ('화재보험',   'fixed', 80),
  ('생명보험',   'fixed', 90),
  ('구독',       'fixed', 100),
  ('대출이자',   'fixed', 110),
  ('적금',       'fixed', 120)
) as v(name, kind, sort_order)
where not exists (select 1 from categories where kind = 'fixed');

-- 15. 푸시 알림 구독 ------------------------------------------------------------

create table if not exists push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
drop policy if exists "auth all" on push_subscriptions;
create policy "auth all" on push_subscriptions for all to authenticated using (true) with check (true);

-- 17. 기념일 ---------------------------------------------------------------------

create table if not exists anniversaries (
  id         bigint generated always as identity primary key,
  title      text not null,
  date       date not null,
  emoji      text not null default '',
  repeat     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table anniversaries enable row level security;
drop policy if exists "auth all" on anniversaries;
create policy "auth all" on anniversaries for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'anniversaries') then
    alter publication supabase_realtime add table anniversaries;
  end if;
end $$;

-- 18. 확인용 ---------------------------------------------------------------------

select 'profiles' as table_name, count(*) as rows from profiles
union all select 'categories', count(*) from categories
union all select 'transactions', count(*) from transactions
union all select 'todos', count(*) from todos
union all select 'events', count(*) from events
union all select 'fixed_costs', count(*) from fixed_costs
union all select 'push_subscriptions', count(*) from push_subscriptions
union all select 'anniversaries', count(*) from anniversaries;
