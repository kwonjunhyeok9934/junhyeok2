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

-- 23번이 늘릴 종류까지 미리 허용한다. 이미 식비 카테고리가 있는 표에 전체를 다시 실행해도
-- 여기서 막히지 않게 하려는 것뿐이고, 최종 상태는 23번이 정한다.
alter table categories drop constraint if exists categories_kind_check;
alter table categories add constraint categories_kind_check
  check (kind in ('expense', 'income', 'fixed', 'meal', 'meal_where', 'meal_how'));

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

-- 19. 알림 웹훅 트리거 (Edge Function 으로 전송) ------------------------------------
-- <함수주소>, <WEBHOOK_SECRET> 은 본인 값으로 바꿔 실행한다.
-- INSERT: transactions / todos / events → 기록한 사람 빼고 알림
-- UPDATE: todos 담당자(assignee) 변경 → 새 담당자에게만 알림

create extension if not exists pg_net;

create or replace function notify_webhook() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := '<함수주소>',
    headers := '{"Content-Type":"application/json","x-webhook-secret":"<WEBHOOK_SECRET>"}'::jsonb,
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'record', to_jsonb(NEW),
      'old_record', case when TG_OP = 'UPDATE' then to_jsonb(OLD) end,
      'actor', auth.uid()
    )
  );
  return NEW;
end $$;

drop trigger if exists notify_transactions on transactions;
create trigger notify_transactions after insert on transactions for each row execute function notify_webhook();
drop trigger if exists notify_todos on todos;
create trigger notify_todos after insert on todos for each row execute function notify_webhook();
drop trigger if exists notify_events on events;
create trigger notify_events after insert on events for each row execute function notify_webhook();
drop trigger if exists notify_todos_assign on todos;
create trigger notify_todos_assign after update of assignee on todos
  for each row when (new.assignee is distinct from old.assignee) execute function notify_webhook();

-- 21. 식비(식단) ---------------------------------------------------------------
-- 금액은 여기 두지 않는다. 돈을 쓴 끼니는 transactions 행 하나와 1:1 로 연결된다.
-- 연결이 끊기면(가계부에서 거래를 지우면) 그 끼니는 '돈 안 쓴 끼니'가 된다.
-- 알림 트리거는 붙이지 않는다: 돈을 쓴 끼니는 transactions 트리거가 이미 한 번 알린다.

create table if not exists meals (
  id             bigint generated always as identity primary key,
  date           date not null,
  -- 'grocery'(장보기)는 아직 화면에 없다. 나중에 쓰려면 SQL 을 또 실행해야 해서 미리 열어 둔다.
  slot           text not null check (slot in ('breakfast', 'lunch', 'dinner', 'night', 'grocery')),
  menu           text not null default '',   -- 먹은 메뉴
  bought         text not null default '',   -- 산 것 (장본 품목)
  category_id    bigint references categories(id) on delete set null,   -- kind='meal'
  transaction_id bigint references transactions(id) on delete set null,
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now()
);

create index if not exists meals_date_idx on meals (date);
-- 한 거래를 두 끼니가 가리키면 합계가 두 번 잡힌다. null 은 여러 개 허용된다.
-- 23번이 이 열을 떼어 가므로, 이미 23번을 돌린 표에 전체를 다시 실행할 때는 건너뛴다.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'meals' and column_name = 'transaction_id') then
    create unique index if not exists meals_transaction_id_key on meals (transaction_id);
  end if;
end $$;

alter table meals enable row level security;
drop policy if exists "auth all" on meals;
create policy "auth all" on meals for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'meals') then
    alter publication supabase_realtime add table meals;
  end if;
end $$;

-- 식비 카테고리 (설정 → 카테고리에서 이름·순서·추가·삭제 가능)
-- 13번과 같은 이유로 23번의 종류까지 미리 허용한다.
alter table categories drop constraint if exists categories_kind_check;
alter table categories add constraint categories_kind_check
  check (kind in ('expense', 'income', 'fixed', 'meal', 'meal_where', 'meal_how'));

-- 23번이 이 행들의 kind 를 'meal_how' 로 바꾸므로 둘 다 보고 판단한다.
-- 'meal' 만 보면 전체를 다시 실행할 때마다 컬리·마트·배달이 한 벌씩 더 생긴다.
insert into categories (name, kind, sort_order)
select * from (values
  ('집밥', 'meal', 10),
  ('배달', 'meal', 20),
  ('포장', 'meal', 30),
  ('외식', 'meal', 40),
  ('마트', 'meal', 50),
  ('컬리', 'meal', 60)
) as v(name, kind, sort_order)
where not exists (select 1 from categories where kind in ('meal', 'meal_how'));

-- 23. 식비 1:N — 누가·어디서 + '어떻게' 세트(품목별 가격) ---------------------------
-- 21번은 "한 끼 = 지출 한 건" 이었다. 실제로는 한 끼에 마트에서 산 재료 + 컬리에서 시킨
-- 재료가 섞이므로 "한 끼 = 구입 여러 건, 구입 한 건 = 품목 여러 줄" 로 바꾼다.
-- 21번을 이미 실행한 사람도, 처음 실행하는 사람도 이 섹션만 돌리면 같은 상태가 된다.
--
-- 금액은 품목(meal_buys.lines)이 원본이고, 가계부 거래에는 그 합계가 들어간다.
-- 세트 하나 : 거래 하나. 세트 합계가 0이면 거래를 만들지 않는다(transactions.amount > 0).

-- 끼니에 '누가'(null = 같이) 와 '어디서'.  where 는 예약어라 place_id 로 쓴다.
alter table meals add column if not exists eater    uuid   references auth.users(id) on delete set null;
alter table meals add column if not exists place_id bigint references categories(id) on delete set null;

-- 21번의 1:1 연결 흔적을 뗀다 (기록이 없으므로 그냥 버린다).
alter table meals drop column if exists transaction_id;
alter table meals drop column if exists category_id;
alter table meals drop column if exists bought;

-- '어떻게' 세트. 한 끼에 0개도, 여러 개도 된다.
create table if not exists meal_buys (
  id             bigint generated always as identity primary key,
  meal_id        bigint not null references meals(id) on delete cascade,
  how_id         bigint references categories(id) on delete set null,   -- kind='meal_how'
  lines          jsonb not null default '[]'::jsonb,   -- [{"name":"삼겹살 600g","amount":12000}, ...]
  transaction_id bigint references transactions(id) on delete set null,
  sort_order     integer not null default 0,
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now()
);

create index if not exists meal_buys_meal_id_idx on meal_buys (meal_id);
-- 한 거래를 두 세트가 가리키면 합계가 두 번 잡힌다. null 은 여러 개 허용된다.
create unique index if not exists meal_buys_transaction_id_key on meal_buys (transaction_id);

alter table meal_buys enable row level security;
drop policy if exists "auth all" on meal_buys;
create policy "auth all" on meal_buys for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'meal_buys') then
    alter publication supabase_realtime add table meal_buys;
  end if;
end $$;

-- 세트가 사라지면 그 거래도 사라진다.
-- 끼니를 지워 cascade 로 세트가 지워질 때도 이 트리거가 돌기 때문에 고아 거래가 생길 수 없다.
-- AFTER 여야 한다: BEFORE 에서 지우면 FK on delete set null 이 지금 지워지는 중인 행을 건드린다.
create or replace function meal_buy_drop_tx() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.transaction_id is not null then
    delete from transactions where id = old.transaction_id;
  end if;
  return null;
end $$;

drop trigger if exists meal_buys_after_delete on meal_buys;
create trigger meal_buys_after_delete after delete on meal_buys
  for each row execute function meal_buy_drop_tx();

-- 카테고리 종류를 '어디서'와 '어떻게' 로 나눈다.
alter table categories drop constraint if exists categories_kind_check;
alter table categories add constraint categories_kind_check
  check (kind in ('expense', 'income', 'fixed', 'meal', 'meal_where', 'meal_how'));

-- 21번이 넣은 kind='meal' 은 '어떻게' 였다. '집밥' 은 '어디서=집' 이 대신하므로 뺀다.
delete from categories c
where c.kind = 'meal' and c.name = '집밥'
  and not exists (select 1 from meal_buys b where b.how_id = c.id);
update categories set kind = 'meal_how' where kind = 'meal';

-- 이미 있는 것은 건너뛰고 없는 것만 채운다 (21번을 먼저 실행한 사람과 상태를 맞추기 위해
-- 표 전체가 아니라 '이름 단위' 로 가드한다).
insert into categories (name, kind, sort_order)
select v.name, 'meal_where', v.sort_order
from (values ('집', 10), ('회사', 20), ('외식', 30)) as v(name, sort_order)
where not exists (select 1 from categories c where c.kind = 'meal_where' and c.name = v.name);

insert into categories (name, kind, sort_order)
select v.name, 'meal_how', v.sort_order
from (values ('컬리', 10), ('쿠팡', 20), ('윙잇', 30), ('배달', 40),
             ('포장', 50), ('외식', 60), ('마트', 70), ('편의점', 80)) as v(name, sort_order)
where not exists (select 1 from categories c where c.kind = 'meal_how' and c.name = v.name);

-- 21번을 먼저 실행한 사람과 칩 순서를 같게 맞춘다.
update categories c set sort_order = v.sort_order
from (values ('컬리', 10), ('쿠팡', 20), ('윙잇', 30), ('배달', 40),
             ('포장', 50), ('외식', 60), ('마트', 70), ('편의점', 80)) as v(name, sort_order)
where c.kind = 'meal_how' and c.name = v.name and c.sort_order is distinct from v.sort_order;

-- 한 번에 전부 되거나, 하나도 안 되거나.
-- 무엇을 할지는 js/calc.js 의 planMealSave 가 정하고 이 함수는 그대로 실행만 한다.
-- (정책이 한 줄도 없으므로 앱을 고쳐도 이 함수는 다시 실행할 일이 없다.)
create or replace function save_meal(p jsonb) returns bigint
language plpgsql as $$
declare
  v_meal bigint := nullif(p -> 'meal' ->> 'id', '')::bigint;
  v_user uuid   := auth.uid();
  m      jsonb  := p -> 'meal' -> 'patch';
  s      jsonb;
  t      jsonb;
  v_tx   bigint;
  v_buy  bigint;
begin
  if v_meal is null then
    insert into meals (date, slot, menu, eater, place_id, created_by)
    values ((m ->> 'date')::date, m ->> 'slot', coalesce(m ->> 'menu', ''),
            nullif(m ->> 'eater', '')::uuid, nullif(m ->> 'place_id', '')::bigint, v_user)
    returning id into v_meal;
  else
    update meals set date = (m ->> 'date')::date, slot = m ->> 'slot', menu = coalesce(m ->> 'menu', ''),
                     eater = nullif(m ->> 'eater', '')::uuid, place_id = nullif(m ->> 'place_id', '')::bigint
    where id = v_meal;
    if not found then   -- 다른 기기에서 이미 지웠다 → 새로 만든다
      insert into meals (date, slot, menu, eater, place_id, created_by)
      values ((m ->> 'date')::date, m ->> 'slot', coalesce(m ->> 'menu', ''),
              nullif(m ->> 'eater', '')::uuid, nullif(m ->> 'place_id', '')::bigint, v_user)
      returning id into v_meal;
    end if;
  end if;

  -- 화면에서 뺀 세트만 지운다 (트리거가 그 거래까지 지운다).
  -- "payload 에 없는 건 다 지운다" 로 하면 다른 폰에서 방금 추가한 세트를 조용히 날린다.
  delete from meal_buys
  where meal_id = v_meal
    and id in (select value::bigint from jsonb_array_elements_text(coalesce(p -> 'removed', '[]'::jsonb)));

  for s in select * from jsonb_array_elements(coalesce(p -> 'buys', '[]'::jsonb)) loop
    t    := s -> 'tx';
    v_tx := nullif(t ->> 'id', '')::bigint;

    if t ->> 'op' = 'insert' then
      insert into transactions (kind, amount, category_id, date, memo, created_by)
      values ('expense', (t -> 'payload' ->> 'amount')::int,
              nullif(t -> 'payload' ->> 'category_id', '')::bigint,
              (t -> 'payload' ->> 'date')::date, t -> 'payload' ->> 'memo', v_user)
      returning id into v_tx;
    elsif t ->> 'op' = 'update' then
      update transactions set kind = 'expense', amount = (t -> 'payload' ->> 'amount')::int,
             category_id = nullif(t -> 'payload' ->> 'category_id', '')::bigint,
             date = (t -> 'payload' ->> 'date')::date, memo = t -> 'payload' ->> 'memo'
      where id = v_tx;
      if not found then   -- 가계부에서 지워진 거래 → 새로 만들어 다시 연결한다
        insert into transactions (kind, amount, category_id, date, memo, created_by)
        values ('expense', (t -> 'payload' ->> 'amount')::int,
                nullif(t -> 'payload' ->> 'category_id', '')::bigint,
                (t -> 'payload' ->> 'date')::date, t -> 'payload' ->> 'memo', v_user)
        returning id into v_tx;
      end if;
    elsif t ->> 'op' = 'delete' then
      delete from transactions where id = v_tx;   -- FK 가 세트의 연결을 끊는다
      v_tx := null;
    end if;

    v_buy := nullif(s ->> 'id', '')::bigint;
    if v_buy is null then
      insert into meal_buys (meal_id, how_id, lines, transaction_id, sort_order, created_by)
      values (v_meal, nullif(s -> 'patch' ->> 'how_id', '')::bigint, s -> 'patch' -> 'lines',
              v_tx, coalesce((s -> 'patch' ->> 'sort_order')::int, 0), v_user);
    else
      update meal_buys
         set how_id = nullif(s -> 'patch' ->> 'how_id', '')::bigint,
             lines = s -> 'patch' -> 'lines',
             sort_order = coalesce((s -> 'patch' ->> 'sort_order')::int, 0),
             transaction_id = case when t ->> 'op' = 'none' then transaction_id else v_tx end
       where id = v_buy and meal_id = v_meal;
      if not found then
        insert into meal_buys (meal_id, how_id, lines, transaction_id, sort_order, created_by)
        values (v_meal, nullif(s -> 'patch' ->> 'how_id', '')::bigint, s -> 'patch' -> 'lines',
                v_tx, coalesce((s -> 'patch' ->> 'sort_order')::int, 0), v_user);
      end if;
    end if;
  end loop;

  return v_meal;
end $$;

-- 25. 식비: 가게 이름 -------------------------------------------------------------
-- 컬리·쿠팡·마트·편의점은 카테고리 이름이 곧 가게지만, 배달·포장·외식은 갈 때마다
-- 가게가 다르다. 그 가게 이름을 세트에 적는다.
-- (배달료는 표를 늘리지 않고 '배달료' 라는 이름의 품목 줄로 둔다.)

alter table meal_buys add column if not exists shop text not null default '';

create or replace function save_meal(p jsonb) returns bigint
language plpgsql as $$
declare
  v_meal bigint := nullif(p -> 'meal' ->> 'id', '')::bigint;
  v_user uuid   := auth.uid();
  m      jsonb  := p -> 'meal' -> 'patch';
  s      jsonb;
  t      jsonb;
  v_tx   bigint;
  v_buy  bigint;
begin
  if v_meal is null then
    insert into meals (date, slot, menu, eater, place_id, created_by)
    values ((m ->> 'date')::date, m ->> 'slot', coalesce(m ->> 'menu', ''),
            nullif(m ->> 'eater', '')::uuid, nullif(m ->> 'place_id', '')::bigint, v_user)
    returning id into v_meal;
  else
    update meals set date = (m ->> 'date')::date, slot = m ->> 'slot', menu = coalesce(m ->> 'menu', ''),
                     eater = nullif(m ->> 'eater', '')::uuid, place_id = nullif(m ->> 'place_id', '')::bigint
    where id = v_meal;
    if not found then   -- 다른 기기에서 이미 지웠다 → 새로 만든다
      insert into meals (date, slot, menu, eater, place_id, created_by)
      values ((m ->> 'date')::date, m ->> 'slot', coalesce(m ->> 'menu', ''),
              nullif(m ->> 'eater', '')::uuid, nullif(m ->> 'place_id', '')::bigint, v_user)
      returning id into v_meal;
    end if;
  end if;

  -- 화면에서 뺀 세트만 지운다 (트리거가 그 거래까지 지운다).
  -- "payload 에 없는 건 다 지운다" 로 하면 다른 폰에서 방금 추가한 세트를 조용히 날린다.
  delete from meal_buys
  where meal_id = v_meal
    and id in (select value::bigint from jsonb_array_elements_text(coalesce(p -> 'removed', '[]'::jsonb)));

  for s in select * from jsonb_array_elements(coalesce(p -> 'buys', '[]'::jsonb)) loop
    t    := s -> 'tx';
    v_tx := nullif(t ->> 'id', '')::bigint;

    if t ->> 'op' = 'insert' then
      insert into transactions (kind, amount, category_id, date, memo, created_by)
      values ('expense', (t -> 'payload' ->> 'amount')::int,
              nullif(t -> 'payload' ->> 'category_id', '')::bigint,
              (t -> 'payload' ->> 'date')::date, t -> 'payload' ->> 'memo', v_user)
      returning id into v_tx;
    elsif t ->> 'op' = 'update' then
      update transactions set kind = 'expense', amount = (t -> 'payload' ->> 'amount')::int,
             category_id = nullif(t -> 'payload' ->> 'category_id', '')::bigint,
             date = (t -> 'payload' ->> 'date')::date, memo = t -> 'payload' ->> 'memo'
      where id = v_tx;
      if not found then   -- 가계부에서 지워진 거래 → 새로 만들어 다시 연결한다
        insert into transactions (kind, amount, category_id, date, memo, created_by)
        values ('expense', (t -> 'payload' ->> 'amount')::int,
                nullif(t -> 'payload' ->> 'category_id', '')::bigint,
                (t -> 'payload' ->> 'date')::date, t -> 'payload' ->> 'memo', v_user)
        returning id into v_tx;
      end if;
    elsif t ->> 'op' = 'delete' then
      delete from transactions where id = v_tx;   -- FK 가 세트의 연결을 끊는다
      v_tx := null;
    end if;

    v_buy := nullif(s ->> 'id', '')::bigint;
    if v_buy is null then
      insert into meal_buys (meal_id, how_id, shop, lines, transaction_id, sort_order, created_by)
      values (v_meal, nullif(s -> 'patch' ->> 'how_id', '')::bigint, coalesce(s -> 'patch' ->> 'shop', ''),
              s -> 'patch' -> 'lines', v_tx, coalesce((s -> 'patch' ->> 'sort_order')::int, 0), v_user);
    else
      update meal_buys
         set how_id = nullif(s -> 'patch' ->> 'how_id', '')::bigint,
             shop = coalesce(s -> 'patch' ->> 'shop', ''),
             lines = s -> 'patch' -> 'lines',
             sort_order = coalesce((s -> 'patch' ->> 'sort_order')::int, 0),
             transaction_id = case when t ->> 'op' = 'none' then transaction_id else v_tx end
       where id = v_buy and meal_id = v_meal;
      if not found then
        insert into meal_buys (meal_id, how_id, shop, lines, transaction_id, sort_order, created_by)
        values (v_meal, nullif(s -> 'patch' ->> 'how_id', '')::bigint, coalesce(s -> 'patch' ->> 'shop', ''),
                s -> 'patch' -> 'lines', v_tx, coalesce((s -> 'patch' ->> 'sort_order')::int, 0), v_user);
      end if;
    end if;
  end loop;

  return v_meal;
end $$;

-- 27. 여행 (다녀온 곳) ---------------------------------------------------------
-- 지도에서 색칠한 시·군·구를 한 줄씩 남긴다. 코드는 js/koreamap.js 의 c 값.
-- 지우면 색이 빠지는 것뿐이라 따로 보관하지 않는다.

create table if not exists visited_regions (
  code       text primary key,            -- 시군구 코드 (예: 39010 제주시)
  name       text not null default '',    -- 칠할 때의 이름. 지도 데이터가 바뀌어도 뭘 칠했는지 남는다
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table visited_regions enable row level security;
drop policy if exists "auth all" on visited_regions;
create policy "auth all" on visited_regions for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'visited_regions') then
    alter publication supabase_realtime add table visited_regions;
  end if;
end $$;

-- 29. 여행 (계획·기록) ---------------------------------------------------------
-- 여행 하나 = 제목 + 기간 + 지역 여러 개(제주 여행이면 제주시·서귀포시).
-- 지도 색칠은 여기서 자동으로 따라간다 — 직접 칠한 곳은 visited_regions 에 그대로 있고,
-- 지도는 둘을 합쳐 보여준다.
-- 여행 중에 쓴 돈은 따로 적지 않는다. 가계부에서 그 기간을 더해 보여 준다.

create table if not exists trips (
  id         bigint generated always as identity primary key,
  title      text not null,
  start_date date not null,
  end_date   date not null,
  memo       text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists trips_start_idx on trips (start_date);

create table if not exists trip_regions (
  trip_id bigint not null references trips(id) on delete cascade,
  code    text not null,                  -- 시군구 코드 (js/koreamap.js 의 c)
  name    text not null default '',       -- 고를 때의 이름
  primary key (trip_id, code)
);

-- 준비물 체크리스트. 할일 탭과 섞이면 지저분해서 여행 안에만 둔다.
create table if not exists trip_items (
  id         bigint generated always as identity primary key,
  trip_id    bigint not null references trips(id) on delete cascade,
  title      text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists trip_items_trip_idx on trip_items (trip_id);

alter table trips        enable row level security;
alter table trip_regions enable row level security;
alter table trip_items   enable row level security;
drop policy if exists "auth all" on trips;
drop policy if exists "auth all" on trip_regions;
drop policy if exists "auth all" on trip_items;
create policy "auth all" on trips        for all to authenticated using (true) with check (true);
create policy "auth all" on trip_regions for all to authenticated using (true) with check (true);
create policy "auth all" on trip_items   for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'trips') then
    alter publication supabase_realtime add table trips;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'trip_regions') then
    alter publication supabase_realtime add table trip_regions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'trip_items') then
    alter publication supabase_realtime add table trip_items;
  end if;

end $$;

-- 31. 식비: 사 둔 것 (품목을 미리 담아 두고 식비에서 꺼내 쓴다) ---------------------
-- 윙잇·컬리·쿠팡·마트·편의점에서 산 품목을 미리 적어 둔다. 여기 적은 가격은 아직
-- 가계부에 안 들어간다 — **그 품목으로 처음 밥을 먹을 때 한 번만** 넘어간다(전가).
-- 한 번에 다 안 먹고 다음에 또 먹으면 그 줄은 0원으로 붙어서 두 번 세지 않는다.
-- 다 먹었으면 '다 씀', 아직 남았으면 '남김' — 남은 것만 드롭다운에 계속 나온다.
--
-- 돈의 원본은 그대로 meal_buys.lines 다. 사 둔 것에서 꺼낸 줄은 pantry_id 를 달고 있을 뿐이고,
-- 세트 합계·거래 금액을 구하는 규칙은 하나도 바뀌지 않는다.

create table if not exists pantry_items (
  id             bigint generated always as identity primary key,
  how_id         bigint  references categories(id) on delete set null,  -- kind='meal_how' (윙잇·컬리…)
  name           text    not null,
  amount         integer not null default 0 check (amount >= 0),        -- 산 가격 (아직 가계부 밖)
  bought_on      date    not null default current_date,
  -- 가격을 가져간 세트. 그 세트가 사라지면 null 이 되어 다음에 다시 전가된다.
  charged_buy_id bigint  references meal_buys(id) on delete set null,
  done           boolean not null default false,                        -- 다 씀 / 남김
  done_buy_id    bigint  references meal_buys(id) on delete set null,   -- '다 씀' 을 누른 세트
  created_by     uuid    not null references auth.users(id),
  created_at     timestamptz not null default now()
);

create index if not exists pantry_items_open_idx on pantry_items (done, how_id);

alter table pantry_items enable row level security;
drop policy if exists "auth all" on pantry_items;
create policy "auth all" on pantry_items for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pantry_items') then
    alter publication supabase_realtime add table pantry_items;
  end if;
end $$;

-- 세트가 사라지면 그 세트가 쥐고 있던 전가와 '다 씀' 을 놓아 준다 (품목은 냉장고로 돌아간다).
-- BEFORE 여야 한다: AFTER 로 두면 FK 의 on delete set null 이 먼저 돌아 old.id 로 찾을 게 없다.
create or replace function meal_buy_free_pantry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update pantry_items set charged_buy_id = null where charged_buy_id = old.id;
  update pantry_items set done = false, done_buy_id = null where done_buy_id = old.id;
  return old;
end $$;

drop trigger if exists meal_buys_before_delete on meal_buys;
create trigger meal_buys_before_delete before delete on meal_buys
  for each row execute function meal_buy_free_pantry();

-- save_meal 에 '사 둔 것' 뒷정리를 더한다. 여기서도 정책은 한 줄도 없다 —
-- 가격을 실은 줄이 곧 전가를 가져가고, 줄에 적힌 done 을 그대로 옮길 뿐이다.
-- (누구에게 값을 실을지는 js/calc.js 의 planMealSave 가 정한다.)
create or replace function save_meal(p jsonb) returns bigint
language plpgsql as $$
declare
  v_meal  bigint := nullif(p -> 'meal' ->> 'id', '')::bigint;
  v_user  uuid   := auth.uid();
  m       jsonb  := p -> 'meal' -> 'patch';
  s       jsonb;
  t       jsonb;
  v_lines jsonb;
  v_tx    bigint;
  v_buy   bigint;
begin
  if v_meal is null then
    insert into meals (date, slot, menu, eater, place_id, created_by)
    values ((m ->> 'date')::date, m ->> 'slot', coalesce(m ->> 'menu', ''),
            nullif(m ->> 'eater', '')::uuid, nullif(m ->> 'place_id', '')::bigint, v_user)
    returning id into v_meal;
  else
    update meals set date = (m ->> 'date')::date, slot = m ->> 'slot', menu = coalesce(m ->> 'menu', ''),
                     eater = nullif(m ->> 'eater', '')::uuid, place_id = nullif(m ->> 'place_id', '')::bigint
    where id = v_meal;
    if not found then   -- 다른 기기에서 이미 지웠다 → 새로 만든다
      insert into meals (date, slot, menu, eater, place_id, created_by)
      values ((m ->> 'date')::date, m ->> 'slot', coalesce(m ->> 'menu', ''),
              nullif(m ->> 'eater', '')::uuid, nullif(m ->> 'place_id', '')::bigint, v_user)
      returning id into v_meal;
    end if;
  end if;

  -- 화면에서 뺀 세트만 지운다 (트리거가 그 거래까지 지운다).
  -- "payload 에 없는 건 다 지운다" 로 하면 다른 폰에서 방금 추가한 세트를 조용히 날린다.
  delete from meal_buys
  where meal_id = v_meal
    and id in (select value::bigint from jsonb_array_elements_text(coalesce(p -> 'removed', '[]'::jsonb)));

  for s in select * from jsonb_array_elements(coalesce(p -> 'buys', '[]'::jsonb)) loop
    t       := s -> 'tx';
    v_lines := coalesce(s -> 'patch' -> 'lines', '[]'::jsonb);
    v_tx    := nullif(t ->> 'id', '')::bigint;

    if t ->> 'op' = 'insert' then
      insert into transactions (kind, amount, category_id, date, memo, created_by)
      values ('expense', (t -> 'payload' ->> 'amount')::int,
              nullif(t -> 'payload' ->> 'category_id', '')::bigint,
              (t -> 'payload' ->> 'date')::date, t -> 'payload' ->> 'memo', v_user)
      returning id into v_tx;
    elsif t ->> 'op' = 'update' then
      update transactions set kind = 'expense', amount = (t -> 'payload' ->> 'amount')::int,
             category_id = nullif(t -> 'payload' ->> 'category_id', '')::bigint,
             date = (t -> 'payload' ->> 'date')::date, memo = t -> 'payload' ->> 'memo'
      where id = v_tx;
      if not found then   -- 가계부에서 지워진 거래 → 새로 만들어 다시 연결한다
        insert into transactions (kind, amount, category_id, date, memo, created_by)
        values ('expense', (t -> 'payload' ->> 'amount')::int,
                nullif(t -> 'payload' ->> 'category_id', '')::bigint,
                (t -> 'payload' ->> 'date')::date, t -> 'payload' ->> 'memo', v_user)
        returning id into v_tx;
      end if;
    elsif t ->> 'op' = 'delete' then
      delete from transactions where id = v_tx;   -- FK 가 세트의 연결을 끊는다
      v_tx := null;
    end if;

    v_buy := nullif(s ->> 'id', '')::bigint;
    if v_buy is null then
      insert into meal_buys (meal_id, how_id, shop, lines, transaction_id, sort_order, created_by)
      values (v_meal, nullif(s -> 'patch' ->> 'how_id', '')::bigint, coalesce(s -> 'patch' ->> 'shop', ''),
              v_lines, v_tx, coalesce((s -> 'patch' ->> 'sort_order')::int, 0), v_user)
      returning id into v_buy;
    else
      update meal_buys
         set how_id = nullif(s -> 'patch' ->> 'how_id', '')::bigint,
             shop = coalesce(s -> 'patch' ->> 'shop', ''),
             lines = v_lines,
             sort_order = coalesce((s -> 'patch' ->> 'sort_order')::int, 0),
             transaction_id = case when t ->> 'op' = 'none' then transaction_id else v_tx end
       where id = v_buy and meal_id = v_meal;
      if not found then
        insert into meal_buys (meal_id, how_id, shop, lines, transaction_id, sort_order, created_by)
        values (v_meal, nullif(s -> 'patch' ->> 'how_id', '')::bigint, coalesce(s -> 'patch' ->> 'shop', ''),
                v_lines, v_tx, coalesce((s -> 'patch' ->> 'sort_order')::int, 0), v_user)
        returning id into v_buy;
      end if;
    end if;

    -- 사 둔 것: 값이 실린 줄이 그 품목의 전가를 가져간다 (0원으로 붙은 줄은 안 가져간다).
    update pantry_items p set charged_buy_id = v_buy
      from jsonb_array_elements(v_lines) as e(line)
     where p.id = nullif(line ->> 'pantry_id', '')::bigint
       and coalesce((line ->> 'amount')::int, 0) > 0;

    -- 이 세트에서 빠진 품목은 놓아 준다 — 다음에 꺼내 쓸 때 값이 다시 붙는다.
    update pantry_items p set charged_buy_id = null
     where p.charged_buy_id = v_buy
       and not exists (
         select 1 from jsonb_array_elements(v_lines) as e(line)
          where nullif(line ->> 'pantry_id', '')::bigint = p.id
            and coalesce((line ->> 'amount')::int, 0) > 0);

    -- 다 씀 / 남김. 다른 세트가 이미 '다 씀' 으로 닫은 품목은 건드리지 않는다
    -- (예전 끼니를 고쳤다고 해서 나중 끼니가 끝낸 품목이 되살아나면 안 된다).
    update pantry_items p
       set done = coalesce((line ->> 'done')::boolean, false),
           done_buy_id = case when coalesce((line ->> 'done')::boolean, false) then v_buy end
      from jsonb_array_elements(v_lines) as e(line)
     where p.id = nullif(line ->> 'pantry_id', '')::bigint
       and (p.done_buy_id is null or p.done_buy_id = v_buy);

    -- 이 세트가 닫았던 품목이 세트에서 빠졌으면 다시 남은 것으로 돌린다.
    update pantry_items p set done = false, done_buy_id = null
     where p.done_buy_id = v_buy
       and not exists (
         select 1 from jsonb_array_elements(v_lines) as e(line)
          where nullif(line ->> 'pantry_id', '')::bigint = p.id
            and coalesce((line ->> 'done')::boolean, false));
  end loop;

  return v_meal;
end $$;

-- 20. 확인용 ---------------------------------------------------------------------

select 'profiles' as table_name, count(*) as rows from profiles
union all select 'categories', count(*) from categories
union all select 'transactions', count(*) from transactions
union all select 'todos', count(*) from todos
union all select 'events', count(*) from events
union all select 'fixed_costs', count(*) from fixed_costs
union all select 'push_subscriptions', count(*) from push_subscriptions
union all select 'anniversaries', count(*) from anniversaries
union all select 'meals', count(*) from meals
union all select 'meal_buys', count(*) from meal_buys
union all select 'pantry_items', count(*) from pantry_items
union all select 'visited_regions', count(*) from visited_regions
union all select 'trips', count(*) from trips
union all select 'trip_regions', count(*) from trip_regions
union all select 'trip_items', count(*) from trip_items;
