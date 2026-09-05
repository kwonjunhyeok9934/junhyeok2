# 부부 앱 — 3차: 스케줄 설계

작성일: 2026-09-05. 1차 뼈대 위에 얹는다.

## 범위

두 사람 일정을 한 달력에서 본다. 일정마다 누구 것(나/배우자/둘 다)과 시간(선택, 비우면 종일)을 붙인다.
뺀 것: 반복 일정, 알림, 여러 날 일정, 외부 캘린더 연동.

## 화면 (스케줄 탭)

1. **월 이동** `◀ 2026년 9월 ▶` (가계부와 같은 모양). 기본 이번 달.
2. **달력**: 일~토 7열, 6줄(42칸). 이번 달이 아닌 칸은 흐리게. 오늘은 테두리, 선택한 날은 액센트 채움.
   일정 있는 날은 날짜 아래 **점**(최대 3개, 사람 색; 둘 다면 회색).
3. **선택한 날 일정**: "9월 5일 (토)" 라벨 + 목록. 행 = 시간(종일이면 "종일") · 제목 · 이니셜(둘 다면 없음).
   종일 먼저, 그 다음 시간순. 비어 있으면 "일정이 없어요".
4. 오른쪽 아래 **+** → 선택한 날짜가 채워진 새 일정 시트.
5. 행 탭 → 편집 시트: 제목 · 날짜 · 시간(`time`, "종일" 버튼으로 비움) · 누구(둘 다/이름1/이름2) · 메모 · 저장 · 삭제.
6. 저장한 날짜가 보고 있는 달과 다르면 그 달·그 날로 이동.

## 데이터

```sql
create table events (
  id         bigint identity primary key,
  title      text not null,
  date       date not null,
  time       time,                                               -- null = 종일
  owner      uuid references auth.users(id) on delete set null,  -- null = 둘 다
  memo       text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
```
RLS·실시간은 다른 표와 같다. 조회는 보고 있는 달 범위만.

## 파일

- `js/schedule.js` (새)
- `js/calc.js`: `calendarGrid(year, month)`, `groupEventsByDate(events)`, `formatTime(t)` 추가 (+ 테스트)
- `js/ledger.js`: + 버튼 바인딩을 빼고 `openNew()` export (app.js가 탭에 따라 연결)
- `js/app.js`: schedule 초기화·실시간·+ 버튼 라우팅(가계부/스케줄), 할일 탭에서만 + 숨김
- `index.html`, `css/app.css`, `supabase/schema.sql`(9장), `sw.js`(v4)
