# 우리집 — 인수인계 (2026-09-13 기준, v19)

두 사람(부부)이 쓰는 PWA. 배포: https://junhyeok2.vercel.app · 저장소: kwonjunhyeok9934/junhyeok2 (`main`에 바로 커밋)

## 구성
- 화면: HTML/CSS/JS 모듈, 빌드 없음. `js/app.js`가 진입점, 탭별 모듈(`home/ledger/fixed/todo/schedule/meal`), 공용(`ui/calc/supabase/categories/push/weather/anniv`)
- 데이터·로그인·실시간·푸시: Supabase (프로젝트 jfrmpmlbweyecwfwlesh). 표 10개, RLS "로그인 사용자 전체 읽기·쓰기", 자가 가입 OFF
- 호스팅: Vercel, `main` 푸시마다 자동 배포. `sw.js`는 network-first 캐시 — 파일 바꾸면 `CACHE` 버전과 `app.js`의 `APP_VERSION`을 같이 올린다(설정 맨 아래에 표시)
- 알림: 웹 푸시. 발송은 Edge Function(대시보드 이름 `rapid-task`), DB 트리거(`notify_webhook`)가 호출. 설정 순서는 `docs/알림_설정.md`
- 비밀값(VAPID 개인키, WEBHOOK_SECRET)은 저장소에 없다. Supabase Edge Function Secrets에만 있음

## 기능 (탭 순서)
홈(히어로·기념일 D-day·날씨/미세먼지·오늘 일정·할일) · 가계부(월/기간 조회, 월별 차트, 카테고리, 식비 기본) · 고정비(주인별, 카테고리 칩) · 할일(해야함/완료됨, 담당·마감) · 스케줄(월간 달력) · 식비(주간 식단 월~일 × 아침·점심·저녁·야식, 누가·어디서 + '어떻게' 세트별 품목·가격)
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
- 시트가 열려 있는 동안 `meal.refresh()` 는 건너뛴다 — 상대가 저장하면 입력 중이던 값이 날아간다.

## 남은 아이디어
지출 검색 · 스케줄 반복 · 가계부 CSV 내보내기 · 연간 보기 · 홈 히어로 배경 사진 · 최근 기록 3개
