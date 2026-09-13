# 우리집 — 인수인계 (2026-09-13 기준, v23)

두 사람(부부)이 쓰는 PWA. 배포: https://junhyeok2.vercel.app · 저장소: kwonjunhyeok9934/junhyeok2 (`main`에 바로 커밋)

## 구성
- 화면: HTML/CSS/JS 모듈, 빌드 없음. `js/app.js`가 진입점, 탭별 모듈(`home/ledger/fixed/todo/schedule/meal/travel/trip`), 공용(`ui/calc/supabase/categories/push/weather/anniv`)
- 데이터·로그인·실시간·푸시: Supabase (프로젝트 jfrmpmlbweyecwfwlesh). 표 15개, RLS "로그인 사용자 전체 읽기·쓰기", 자가 가입 OFF
- 호스팅: Vercel, `main` 푸시마다 자동 배포. `sw.js`는 network-first 캐시 — 파일 바꾸면 `CACHE` 버전과 `app.js`의 `APP_VERSION`을 같이 올린다(설정 맨 아래에 표시)
- 알림: 웹 푸시. 발송은 Edge Function(대시보드 이름 `rapid-task`), DB 트리거(`notify_webhook`)가 호출. 설정 순서는 `docs/알림_설정.md`
- 비밀값(VAPID 개인키, WEBHOOK_SECRET)은 저장소에 없다. Supabase Edge Function Secrets에만 있음

## 기능 (탭 순서)
아래 탭바는 **홈 · 가계부 · 일정 · 여행** 네 칸. 칸 안에서 상단 작은 탭(`#subtabs`, app.js 가 그린다)으로 화면을 바꾼다.
화면은 여덟 개이고 예전 주소 해시(`#ledger` `#meal` `#fixed` `#schedule` `#todo`)는 그대로다 — 알림 딥링크를 건드리지 않으려고 그렇게 뒀다.
탭바를 다시 누르면 그 칸에서 마지막으로 보던 화면으로 돌아간다(`lastSeen`).

- 홈: 히어로·기념일 D-day·날씨/미세먼지·오늘 일정·할일
- 가계부 칸: 가계부(월/기간 조회, 월별 차트, 카테고리) · 식비(주간 식단, 누가·어디서 + '어떻게' 세트별 품목·가격) · 고정비(주인별, 카테고리 칩)
- 일정 칸: 스케줄(월간 달력) · 할일(해야함/완료됨, 담당·마감)
- 여행 칸: 지도(시군구 색칠·지역 시트) · 내 여행(여행 목록·상세·일차별 일정) · 준비물(공용 체크리스트)

설정: 내 이름 · 기념일 · 알림 · 화면(테마) · 카테고리(지출/수입/고정비/식비 어디서·어떻게) · 로그아웃

## 작업 방식
- 새 표/열이 필요하면 `supabase/schema.sql`에 "여러 번 실행 안전" 형태로 추가하고, 사용자가 SQL Editor에서 실행 (Claude는 Supabase에 직접 접속 불가)
- 검증: `npm test`(calc 순수 함수) + Playwright 스모크(세션 스크래치패드 `smoke*.mjs`, 가짜 Supabase 모듈 주입). 수동 체크리스트 `docs/checklist/ledger_v1.html`
- 설계 문서: `docs/superpowers/specs/`

## 식비 탭 메모 (v18 구조)
- `meals`(끼니: 날짜·끼니·메뉴·`eater`·`place_id`) → `meal_buys`(어떻게 세트: `how_id`,
  품목 목록 `lines` jsonb, `transaction_id`) 2단. **세트 하나 : 가계부 거래 하나.**
- **품목 가격이 원본, 거래 금액은 그 합계의 거울.** 저장할 때마다 합계를 다시 계산해 덮어쓴다.
  (v17 까지는 "금액은 가계부에만" 이었는데 품목별 가격이 생기면서 원칙이 바뀌었다.)
- 저장은 `save_meal(p jsonb)` **RPC 한 번**. 무엇을 쓸지는 `js/calc.js` 의 `planMealSave` 가 정하고
  RPC 는 실행만 한다(정책이 한 줄도 없어서 앱을 고쳐도 SQL 을 다시 실행할 일이 없다).
- **고아 거래는 DB 가 막는다**: `meal_buys` AFTER DELETE 트리거가 연결된 거래를 지운다.
  끼니를 지우면 cascade 로 세트가 지워지면서 트리거가 돌기 때문에 클라이언트는
  `delete from meals where id=?` 한 줄이면 된다.
- 카테고리 kind 는 `meal_where`(집·회사·외식)와 `meal_how`(컬리·쿠팡·윙잇·배달·포장·외식·마트·편의점).
  둘 다 설정 화면에서 편집된다. '집밥' 카테고리는 없어지고 '어디서=집' 이 그 역할을 한다.
- **가게 이름**(`meal_buys.shop`)은 배달·포장·외식에서만 칸이 나오고, **배달료**는 배달에서만
  품목 맨 밑에 이름 고정 줄로 놓인다. 값을 안 적으면 저장 때 버려진다.
  ⚠️ 이 셋은 `js/calc.js` 의 `HOW_NEEDS_SHOP`·`HOW_HAS_FEE` 에 **이름으로** 적혀 있다 —
  설정에서 '배달' 을 개명하면 가게 이름·배달료 칸이 안 나온다. 배달 카테고리를 더 만들 거면
  그 배열에 이름을 추가해야 한다.
- 알림 트리거는 식비 표에 안 붙인다. 다만 **세트가 N개면 `transactions` insert 트리거가 N번 돌아
  진동이 N번** 울린다(카드는 `tag:'couple'` 로 1장). 세트는 보통 1~2개라 그대로 뒀다.
- 주간 목록 한 줄: 왼쪽에 끼니 + 누가 뱃지(같이/이름, 이름은 프로필 색), 가운데 첫 줄에
  메뉴(두 줄까지) + 어디서 뱃지, 그 아래 세트마다 어떻게 뱃지 + 가게·품목·가격, 맨 오른쪽에 합계.
  `.meal-buy` 에 `word-break: keep-all` 이 없으면 한글이 '양 파' 처럼 단어 중간에서 잘린다.
- 시트가 열려 있는 동안 `meal.refresh()` 는 건너뛴다 — 상대가 저장하면 입력 중이던 값이 날아간다.

## 여행 탭 메모
- 지도는 `js/koreamap.js` (자동 생성 149KB). 만드는 방법과 원칙은 `docs/지도_데이터.md`. 손으로 고치지 않는다.
- 화면이 둘이다. `travel.js` = 지도 + 지역 시트, `trip.js` = 내 여행 목록·상세·만들기.
  `travel.js` 가 `trip.js` 를 가져다 쓰고(지역 시트에 여행 목록·만들기 버튼), 반대 방향은 없다 —
  여행이 바뀌면 `app.js` 가 `trip.init({ onChange })` 로 받아 `travel.render()` 를 부른다. 순환 import 를 피하려고 이렇게 뒀다.
- 지도 이름표는 `#map-labels` 의 `<text>` 229개. 글자 크기는 배율에 반비례해서 화면에선 늘 13px,
  "이름이 들어갈 만큼 지역이 커 보이는가" 로 보여 줄지 정하고(칠한 곳은 기준이 훨씬 낮다), 겹치면 덜 중요한 쪽을 숨긴다.
  탭이 숨어 있으면 지도 크기를 못 재니 `ResizeObserver` 로 보이는 순간 다시 잡는다.
- 여행 상세의 작은 지도(`miniMap`)는 그 여행 지역 언저리만 잘라 그린다. 지도 데이터의 `b`(경계 상자)로
  자를 곳을 정하고 근처 지역만 그려서 229개를 다 그리지 않는다.
- 여행 하나 = `trips`(제목·기간·메모) + `trip_regions`(시군구 코드 여러 개).
  지도 색은 `visited_regions`(직접 칠함, 연한 색) ∪ `trip_regions`(여행 기록, 진한 색). 여행을 지우면 색도 따라 빠진다.
- **이름은 안 적어도 된다.** 비우면 `nextTripName(지역, 다녀온 횟수)` 로 "제주시 3" 처럼 짓는다. 시트 순서도 어디 → 언제 → 이름이다.
- **준비물은 공용 한 벌**(`packing_items`, 여행 칸의 준비물 화면 = `js/packing.js`). 여행에서는 `trip_packed` 에
  줄이 있으면 체크된 것 — 여행마다 목록을 새로 적지 않는다.
- **일정은 `trip_plans`**. 하루에 여러 줄이고 "어디(place) + 얼마(amount)". 금액이 있으면 가계부 거래 하나와 1:1 로 붙는다
  (식비 `meal_buys` 와 같은 방식). 쓰기는 `save_trip_plan(p jsonb)` RPC 한 번, 줄을 지우면 AFTER DELETE 트리거가 거래까지 지운다.
  카테고리는 `expense/여행` (31번이 없으면 만든다).
- '가계부에서 이 기간 보기' 는 `ledger.showRange(start, end)` 로 조회 기간을 바꾼 뒤 탭을 옮긴다.
- 시트(z-index 35)는 오버레이(여행 상세·설정, 30) 위에 뜬다. 여행 상세에서 일정 시트를 열기 때문 — 낮추면 시트가 안 보인다.
- 칠한 곳은 `visited_regions` 에 `code` 한 줄. 지우면 색만 빠진다. `code` 는 지도 데이터의 `c` 와 같은 값이라 지도를 다시 만들면 맞춰 옮겨야 한다(그래서 `name` 도 같이 저장한다).
- 확대·이동은 `<g id="map-layer">` 의 transform 하나로 끝낸다. 손가락은 **움직이기 시작할 때만** 붙잡는다(`setPointerCapture`) —
  처음부터 붙잡으면 지도 위 ＋/− 버튼의 클릭이 지도로 끌려가 버튼이 죽는다(한 번 겪은 버그).
- 실시간 구독은 `travel-changes` 채널로 따로 뒀다(visited_regions·trips·trip_regions·trip_plans·trip_packed·packing_items). 아직 27·29·31번 SQL 을 안 돌린 상태에서도 나머지 구독이 멀쩡하도록.

## 남은 아이디어
지출 검색 · 스케줄 반복 · 가계부 CSV 내보내기 · 연간 보기 · 홈 히어로 배경 사진 · 최근 기록 3개 · 여행 탭(일정에 사진·시간, 세계 지도, 홈에 다가오는 여행 D-day 카드, 여행 지출을 거래에 직접 묶기, 여행 만들면 상대에게 알림)
