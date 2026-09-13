# 우리집 — 인수인계 (2026-09-13 기준, v17)

두 사람(부부)이 쓰는 PWA. 배포: https://junhyeok2.vercel.app · 저장소: kwonjunhyeok9934/junhyeok2 (`main`에 바로 커밋)

## 구성
- 화면: HTML/CSS/JS 모듈, 빌드 없음. `js/app.js`가 진입점, 탭별 모듈(`home/ledger/fixed/todo/schedule/meal`), 공용(`ui/calc/supabase/categories/push/weather/anniv`)
- 데이터·로그인·실시간·푸시: Supabase (프로젝트 jfrmpmlbweyecwfwlesh). 표 9개, RLS "로그인 사용자 전체 읽기·쓰기", 자가 가입 OFF
- 호스팅: Vercel, `main` 푸시마다 자동 배포. `sw.js`는 network-first 캐시 — 파일 바꾸면 `CACHE` 버전과 `app.js`의 `APP_VERSION`을 같이 올린다(설정 맨 아래에 표시)
- 알림: 웹 푸시. 발송은 Edge Function(대시보드 이름 `rapid-task`), DB 트리거(`notify_webhook`)가 호출. 설정 순서는 `docs/알림_설정.md`
- 비밀값(VAPID 개인키, WEBHOOK_SECRET)은 저장소에 없다. Supabase Edge Function Secrets에만 있음

## 기능 (탭 순서)
홈(히어로·기념일 D-day·날씨/미세먼지·오늘 일정·할일) · 가계부(월/기간 조회, 월별 차트, 카테고리, 식비 기본) · 고정비(주인별, 카테고리 칩) · 할일(해야함/완료됨, 담당·마감) · 스케줄(월간 달력) · 식비(주간 식단 월~일 × 아침·점심·저녁·야식, 금액은 가계부와 자동 연동)
설정: 내 이름 · 기념일 · 알림 · 화면(테마) · 카테고리(지출/수입/고정비/식비) · 로그아웃

## 작업 방식
- 새 표/열이 필요하면 `supabase/schema.sql`에 "여러 번 실행 안전" 형태로 추가하고, 사용자가 SQL Editor에서 실행 (Claude는 Supabase에 직접 접속 불가)
- 검증: `npm test`(calc 순수 함수) + Playwright 스모크(세션 스크래치패드 `smoke*.mjs`, 가짜 Supabase 모듈 주입). 수동 체크리스트 `docs/checklist/ledger_v1.html`
- 설계 문서: `docs/superpowers/specs/`

## 식비 탭 메모
- `meals` 에 금액이 없다. 돈을 쓴 끼니만 `transactions` 행 하나와 `meals.transaction_id` 로 연결된다.
  가계부에서 그 거래를 지우면 FK `on delete set null` 로 연결이 끊기고 그 끼니는 '돈 안 쓴 끼니'가 된다(정상 상태).
- 쓰기 순서는 언제나 "가계부 먼저, 식단 나중". 중간에 실패해도 금액이 조용히 사라지지 않고
  가계부에 보이는 행이 남는다. 거래를 만든 뒤 식단 저장이 실패하면 `pendingTxId` 로 재시도 때 재사용해 중복을 막는다.
- 카테고리는 `categories` 의 `kind='meal'`. '집밥' 을 고르면 금액·산 것 칸이 숨는다(이름으로 판별).
- 알림 트리거는 `meals` 에 붙이지 않는다 — 돈을 쓴 끼니는 `transactions` 트리거가 이미 알린다.

## 남은 아이디어
지출 검색 · 스케줄 반복 · 가계부 CSV 내보내기 · 연간 보기 · 홈 히어로 배경 사진 · 최근 기록 3개
