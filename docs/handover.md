# 우리집 — 인수인계 (2026-09-13 기준, v19)

두 사람(부부)이 쓰는 PWA. 배포: https://junhyeok2.vercel.app · 저장소: kwonjunhyeok9934/junhyeok2 (`main`에 바로 커밋)

## 구성
- 화면: HTML/CSS/JS 모듈, 빌드 없음. `js/app.js`가 진입점, 탭별 모듈(`home/ledger/fixed/todo/schedule/meal/travel/trip`), 공용(`ui/calc/supabase/categories/push/weather/anniv`)
- 데이터·로그인·실시간·푸시: Supabase (프로젝트 jfrmpmlbweyecwfwlesh). 표 13개, RLS "로그인 사용자 전체 읽기·쓰기", 자가 가입 OFF
- 호스팅: Vercel, `main` 푸시마다 자동 배포. `sw.js`는 network-first 캐시 — 파일 바꾸면 `CACHE` 버전과 `app.js`의 `APP_VERSION`을 같이 올린다(설정 맨 아래에 표시)
- 알림: 웹 푸시. 발송은 Edge Function(대시보드 이름 `rapid-task`), DB 트리거(`notify_webhook`)가 호출. 설정 순서는 `docs/알림_설정.md`
- 비밀값(VAPID 개인키, WEBHOOK_SECRET)은 저장소에 없다. Supabase Edge Function Secrets에만 있음

## 기능 (탭 순서)
아래 탭바는 **홈 · 가계부 · 일정 · 여행** 네 칸. 칸 안에서 상단 작은 탭(`#subtabs`, app.js 가 그린다)으로 화면을 바꾼다.
화면 자체는 예전 그대로 일곱 개이고 주소 해시(`#ledger` `#meal` `#fixed` `#schedule` `#todo` `#travel`)도 그대로다 — 알림 딥링크를 건드리지 않으려고 그렇게 뒀다.
탭바를 다시 누르면 그 칸에서 마지막으로 보던 화면으로 돌아간다(`lastSeen`).

- 홈: 히어로·기념일 D-day·날씨/미세먼지·오늘 일정·할일
- 가계부 칸: 가계부(월/기간 조회, 월별 차트, 카테고리) · 식비(주간 식단, 금액은 가계부와 자동 연동) · 고정비(주인별, 카테고리 칩)
- 일정 칸: 스케줄(월간 달력) · 할일(해야함/완료됨, 담당·마감)
- 여행 칸: 지도(시군구 색칠·지역 시트) · 내 여행(여행 목록·상세·준비물)

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

## 여행 탭 메모
- 지도는 `js/koreamap.js` (자동 생성 149KB). 만드는 방법과 원칙은 `docs/지도_데이터.md`. 손으로 고치지 않는다.
- 화면이 둘이다. `travel.js` = 지도 + 지역 시트, `trip.js` = 내 여행 목록·상세·만들기.
  `travel.js` 가 `trip.js` 를 가져다 쓰고(지역 시트에 여행 목록·만들기 버튼), 반대 방향은 없다 —
  여행이 바뀌면 `app.js` 가 `trip.init({ onChange })` 로 받아 `travel.render()` 를 부른다. 순환 import 를 피하려고 이렇게 뒀다.
- 여행 하나 = `trips`(제목·기간·메모) + `trip_regions`(시군구 코드 여러 개) + `trip_items`(준비물).
  지도 색은 `visited_regions`(직접 칠함, 연한 색) ∪ `trip_regions`(여행 기록, 진한 색). 여행을 지우면 색도 따라 빠진다.
- 여행 지출은 따로 표를 만들지 않았다. 여행 기간으로 `transactions` 를 더해 보여 주고,
  '가계부에서 이 기간 보기' 는 `ledger.showRange(start, end)` 로 조회 기간을 바꾼 뒤 탭을 옮긴다.
- 준비물은 `할일` 탭과 섞지 않으려고 `trip_items` 로 따로 뒀다.
- 칠한 곳은 `visited_regions` 에 `code` 한 줄. 지우면 색만 빠진다. `code` 는 지도 데이터의 `c` 와 같은 값이라 지도를 다시 만들면 맞춰 옮겨야 한다(그래서 `name` 도 같이 저장한다).
- 확대·이동은 `<g id="map-layer">` 의 transform 하나로 끝낸다. 손가락은 **움직이기 시작할 때만** 붙잡는다(`setPointerCapture`) —
  처음부터 붙잡으면 지도 위 ＋/− 버튼의 클릭이 지도로 끌려가 버튼이 죽는다(한 번 겪은 버그).
- 실시간 구독은 `travel-changes` 채널로 따로 뒀다(visited_regions·trips·trip_regions·trip_items). 아직 23·25번 SQL 을 안 돌린 상태에서도 나머지 구독이 멀쩡하도록.

## 남은 아이디어
지출 검색 · 스케줄 반복 · 가계부 CSV 내보내기 · 연간 보기 · 홈 히어로 배경 사진 · 최근 기록 3개 · 여행 탭(일차별 일정·사진, 세계 지도, 홈에 다가오는 여행 D-day 카드, 여행 지출을 거래에 직접 묶기, 여행 만들면 상대에게 알림)
