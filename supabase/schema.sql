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
create unique index if not exists meals_transaction_id_key on meals (transaction_id);

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
alter table categories drop constraint if exists categories_kind_check;
alter table categories add constraint categories_kind_check check (kind in ('expense', 'income', 'fixed', 'meal'));

insert into categories (name, kind, sort_order)
select * from (values
  ('집밥', 'meal', 10),
  ('배달', 'meal', 20),
  ('포장', 'meal', 30),
  ('외식', 'meal', 40),
  ('마트', 'meal', 50),
  ('컬리', 'meal', 60)
) as v(name, kind, sort_order)
where not exists (select 1 from categories where kind = 'meal');

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
-- 준비물과 일정은 31번에 있다. 여행 중에 쓴 돈은 그 일정 줄에서 가계부로 넘어간다.

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

alter table trips        enable row level security;
alter table trip_regions enable row level security;
drop policy if exists "auth all" on trips;
drop policy if exists "auth all" on trip_regions;
create policy "auth all" on trips        for all to authenticated using (true) with check (true);
create policy "auth all" on trip_regions for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'trips') then
    alter publication supabase_realtime add table trips;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'trip_regions') then
    alter publication supabase_realtime add table trip_regions;
  end if;

end $$;

-- 31. 여행 준비물·일정 ---------------------------------------------------------
-- 준비물은 여행마다 새로 적지 않는다. 공용 체크리스트(packing_items)를 한 벌 두고
-- 여행에서는 "챙겼다" 만 체크한다(trip_packed 에 줄이 있으면 체크된 것).
-- 일정은 하루에 여러 줄이다. 어디를 갔고 얼마를 썼는지 적으면 금액은 가계부 거래로 따라 들어간다
-- (식비와 같은 방식: 줄 하나 = 거래 하나, 줄을 지우면 트리거가 거래도 지운다).

drop table if exists trip_items;   -- 29번의 '여행마다 적는 준비물' → 공용 체크리스트로 바뀌었다

create table if not exists packing_items (
  id         bigint generated always as identity primary key,
  title      text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists trip_packed (
  trip_id bigint not null references trips(id) on delete cascade,
  item_id bigint not null references packing_items(id) on delete cascade,
  primary key (trip_id, item_id)
);

create table if not exists trip_plans (
  id             bigint generated always as identity primary key,
  trip_id        bigint not null references trips(id) on delete cascade,
  date           date not null,                  -- 며칠째인지는 날짜로 둔다 (기간을 고쳐도 안 어긋나게)
  place          text not null default '',       -- 어디
  memo           text not null default '',
  amount         integer not null default 0 check (amount >= 0),   -- 얼마 (가계부 거래의 원본)
  transaction_id bigint references transactions(id) on delete set null,
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now()
);
create index if not exists trip_plans_trip_idx on trip_plans (trip_id, date);
-- 한 거래를 두 줄이 가리키면 합계가 두 번 잡힌다. null 은 여러 개 허용된다.
create unique index if not exists trip_plans_transaction_id_key on trip_plans (transaction_id);

alter table packing_items enable row level security;
alter table trip_packed   enable row level security;
alter table trip_plans    enable row level security;
drop policy if exists "auth all" on packing_items;
drop policy if exists "auth all" on trip_packed;
drop policy if exists "auth all" on trip_plans;
create policy "auth all" on packing_items for all to authenticated using (true) with check (true);
create policy "auth all" on trip_packed   for all to authenticated using (true) with check (true);
create policy "auth all" on trip_plans    for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'packing_items') then
    alter publication supabase_realtime add table packing_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'trip_packed') then
    alter publication supabase_realtime add table trip_packed;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'trip_plans') then
    alter publication supabase_realtime add table trip_plans;
  end if;
end $$;

-- 일정 줄이 사라지면 그 거래도 사라진다 (여행을 지워 cascade 로 지워질 때도 돈다).
-- AFTER 여야 한다: BEFORE 에서 지우면 FK on delete set null 이 지금 지워지는 중인 행을 건드린다.
create or replace function trip_plan_drop_tx() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.transaction_id is not null then
    delete from transactions where id = old.transaction_id;
  end if;
  return null;
end $$;

drop trigger if exists trip_plans_after_delete on trip_plans;
create trigger trip_plans_after_delete after delete on trip_plans
  for each row execute function trip_plan_drop_tx();

-- 일정 한 줄 저장: 가계부 거래와 함께 한 번에 쓴다. 중간에 실패하면 아무것도 안 쓰인다.
create or replace function save_trip_plan(p jsonb) returns bigint
language plpgsql as $$
declare
  v_id     bigint := nullif(p ->> 'id', '')::bigint;
  v_tx     bigint := nullif(p ->> 'transaction_id', '')::bigint;
  v_user   uuid   := auth.uid();
  v_amount int    := coalesce((p ->> 'amount')::int, 0);
  v_date   date   := (p ->> 'date')::date;
  v_cat    bigint := nullif(p ->> 'category_id', '')::bigint;
  v_memo   text   := coalesce(p ->> 'tx_memo', '');
begin
  -- 1) 가계부
  if v_amount > 0 then
    if v_tx is null then
      insert into transactions (kind, amount, category_id, date, memo, created_by)
      values ('expense', v_amount, v_cat, v_date, v_memo, v_user) returning id into v_tx;
    else
      update transactions set amount = v_amount, category_id = v_cat, date = v_date, memo = v_memo
      where id = v_tx;
      if not found then   -- 가계부에서 지워진 거래 → 새로 만들어 다시 연결한다
        insert into transactions (kind, amount, category_id, date, memo, created_by)
        values ('expense', v_amount, v_cat, v_date, v_memo, v_user) returning id into v_tx;
      end if;
    end if;
  elsif v_tx is not null then
    delete from transactions where id = v_tx;   -- 금액을 지웠다
    v_tx := null;
  end if;

  -- 2) 일정
  if v_id is null then
    insert into trip_plans (trip_id, date, place, memo, amount, transaction_id, created_by)
    values ((p ->> 'trip_id')::bigint, v_date, coalesce(p ->> 'place', ''), coalesce(p ->> 'memo', ''),
            v_amount, v_tx, v_user)
    returning id into v_id;
  else
    update trip_plans set date = v_date, place = coalesce(p ->> 'place', ''), memo = coalesce(p ->> 'memo', ''),
           amount = v_amount, transaction_id = v_tx
    where id = v_id;
    if not found then   -- 상대가 지운 줄 → 새로 만든다
      insert into trip_plans (trip_id, date, place, memo, amount, transaction_id, created_by)
      values ((p ->> 'trip_id')::bigint, v_date, coalesce(p ->> 'place', ''), coalesce(p ->> 'memo', ''),
              v_amount, v_tx, v_user)
      returning id into v_id;
    end if;
  end if;
  return v_id;
end $$;

-- 여행 지출이 들어갈 가계부 카테고리 (없을 때만 만든다)
insert into categories (name, kind, sort_order)
select '여행', 'expense', 95
where not exists (select 1 from categories where kind = 'expense' and name = '여행');

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
union all select 'visited_regions', count(*) from visited_regions
union all select 'trips', count(*) from trips
union all select 'trip_plans', count(*) from trip_plans
union all select 'packing_items', count(*) from packing_items;
