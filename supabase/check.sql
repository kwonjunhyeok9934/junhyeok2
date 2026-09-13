-- 잘 깔렸는지 보는 쪽지. Supabase SQL Editor 에 통째로 붙여 Run 하면 된다.
-- '있음' 이 아닌 줄이 하나라도 있으면 schema.sql 전체를 다시 한 번 실행하면 된다.

select '표 trips'            as 확인, case when to_regclass('public.trips')         is null then '없음' else '있음' end as 결과
union all select '표 trip_regions',    case when to_regclass('public.trip_regions')  is null then '없음' else '있음' end
union all select '표 trip_plans',      case when to_regclass('public.trip_plans')    is null then '없음' else '있음' end
union all select '표 trip_costs',      case when to_regclass('public.trip_costs')    is null then '없음' else '있음' end
union all select '표 packing_items',   case when to_regclass('public.packing_items') is null then '없음' else '있음' end
union all select '표 trip_packed',     case when to_regclass('public.trip_packed')   is null then '없음' else '있음' end
union all select '열 trip_plans.prep',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'trip_plans' and column_name = 'prep') then '있음' else '없음' end
union all select '함수 save_trip_plan',
       case when exists (select 1 from pg_proc where proname = 'save_trip_plan') then '있음' else '없음' end
union all select '함수 save_meal',
       case when exists (select 1 from pg_proc where proname = 'save_meal') then '있음' else '없음' end
union all select '함수 notify_webhook',
       case when exists (select 1 from pg_proc where proname = 'notify_webhook') then '있음' else '없음' end
union all select '표 app_settings (알림 주소)',
       case when to_regclass('public.app_settings') is null then '없음' else '있음' end;

-- 알림 주소가 들어 있는지 (위가 다 '있음' 일 때만 돈다):
--   select key, value from app_settings;
