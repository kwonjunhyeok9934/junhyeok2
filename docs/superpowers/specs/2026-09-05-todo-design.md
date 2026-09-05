# 부부 앱 — 2차: 할일 설계

작성일: 2026-09-05. 1차 스펙(`2026-09-05-couple-ledger-design.md`)의 뼈대 위에 얹는다.

## 범위

두 사람이 함께 보는 **공유 할일 목록 하나**. 항목마다 담당자(나/배우자/둘 다)와 마감일을 선택으로 붙일 수 있다.
뺀 것: 반복 할일, 알림, 우선순위, 하위 항목, 개인 전용 목록.

## 화면 (할일 탭)

1. **빠른 입력 줄**: 제목 입력 + Enter(또는 추가 버튼) → 즉시 저장. 담당자·마감일 없음.
2. **미완료 목록**: 행 = 체크박스 · 제목 · 마감 라벨 · 담당자 이니셜(둘 다면 표시 없음).
   - 정렬: 마감일 있는 것 먼저(가까운 순), 그 다음 마감 없는 것(만든 순).
   - 마감 라벨: 지났으면 "N일 지남"(빨강), 오늘 "오늘", 내일 "내일", 그 외 "M월 D일".
3. **완료됨** (`details`, 기본 접힘): 완료 시각 최신순. 체크 해제하면 미완료로 돌아간다. "완료 모두 삭제" 버튼(확인창).
4. 행(체크박스 외)을 누르면 **편집 시트**: 제목 · 담당자(둘 다/이름1/이름2 세그먼트) · 마감일(`date`, 지우기 버튼) · 저장 · 삭제.
5. 비어 있으면 "할일이 없어요. 위에 적어 보세요".
6. 할일 탭에서는 오른쪽 아래 + 버튼을 숨긴다(빠른 입력 줄이 그 역할).

## 데이터

```sql
create table todos (
  id         bigint identity primary key,
  title      text not null,
  done       boolean not null default false,
  done_at    timestamptz,
  assignee   uuid references auth.users(id) on delete set null,  -- null = 둘 다
  due        date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
```
RLS 정책은 다른 표와 같다(로그인 사용자 전체 읽기·쓰기). `supabase_realtime`에 추가.

## 파일

- `js/todo.js` (새): 조회·렌더·빠른 입력·토글·편집 시트
- `js/calc.js`: `dueLabel(due, today)`, `sortTodos(todos)` 추가 (+ 테스트)
- `index.html`, `css/app.css`: 할일 탭 내용, 편집 시트, 스타일
- `js/app.js`: todo 초기화·실시간 구독·visibilitychange
- `supabase/schema.sql`: 7장 todos 추가 (여러 번 실행 안전)
- `sw.js`: 캐시 목록에 `todo.js`, 버전 올림

## 에러 처리

가계부와 동일: 실패 시 토스트, 시트 유지. 조회 실패 시 "불러오지 못했어요" + 다시 시도.
