# 부부 앱 1차 (뼈대 + 가계부) 구현 계획

> **For agentic workers:** 스펙은 `docs/superpowers/specs/2026-09-05-couple-ledger-design.md`. 작업은 순서대로, 작업마다 커밋한다. 체크박스(`- [ ]`)로 진행을 표시한다.

**Goal:** 두 사람이 폰 홈 화면에서 열어 쓰는 공유 가계부 PWA. 로그인·탭 껍데기·가계부·실시간 반영·설치까지 한 번에 동작.

**Architecture:** 빌드 없는 정적 파일(HTML/CSS/ES 모듈) + Supabase(Postgres·Auth·Realtime). `calc.js`는 순수 함수만 두어 node 테스트로 검증하고, 화면 모듈(`ledger.js`, `categories.js`)은 Supabase 조회와 자기 화면 렌더만 담당한다. `app.js`가 세션·탭·실시간을 이어 준다.

**Tech Stack:** HTML, CSS, JavaScript(ES2022 모듈), `@supabase/supabase-js@2` (jsDelivr ESM), Node 22 `node:test`, Vercel 정적 호스팅.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `index.html` | 화면 뼈대 전부(로그인·메인·시트·설정·토스트). 섹션 show/hide |
| `css/app.css` | 전체 스타일. 모바일 우선, 라이트/다크 |
| `js/config.js` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` 두 상수 |
| `js/supabase.js` | 클라이언트 생성, `getSession/signIn/signOut/onAuthChange` |
| `js/calc.js` | 순수 함수: 월 범위·이동·라벨, 요약, 카테고리 합계, 날짜 묶기, 금액 포맷, 오늘 |
| `js/ui.js` | `$`, `openSheet/closeSheet`, `toast`, `confirmDialog` |
| `js/categories.js` | categories CRUD·순서 + 설정 화면 렌더 |
| `js/ledger.js` | 가계부 탭: 조회·요약·목록 렌더, 입력 시트 저장/삭제 |
| `js/app.js` | 진입점: 설정 확인→세션→화면 전환, 해시 탭, 실시간 구독, visibilitychange |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |
| `supabase/schema.sql` | 표·RLS·트리거·실시간·기본 카테고리 |
| `tests/calc.test.js` | calc.js 검증 |
| `docs/checklist/ledger_v1.html` | 수동 검증 체크리스트 |
| `README.md` | 설치·배포 순서 |

---

### Task 1: 저장소 기본 파일

**Files:** Create `.gitignore`, `README.md`(초안), `package.json`(테스트 스크립트만)

- [ ] `.gitignore`: `.vercel/`, `.DS_Store`, `node_modules/`
- [ ] `package.json`: `{"name":"junhyeok2","private":true,"type":"module","scripts":{"test":"node --test tests/"}}` — 의존성 없음
- [ ] `README.md`: 제목 + "설치·배포 순서는 Task 9에서 채움" 대신 스펙 6장 내용을 바로 적는다
- [ ] Commit: `chore: 저장소 기본 파일`

### Task 2: calc.js — 테스트 먼저

**Files:** Create `tests/calc.test.js`, `js/calc.js`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/calc.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthRange, shiftMonth, monthLabel, summarize, sumByCategory,
  groupByDate, formatWon, parseWon,
} from '../js/calc.js';

test('monthRange: 해당 월 1일과 말일', () => {
  assert.deepEqual(monthRange(2026, 9), { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(monthRange(2026, 2), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(monthRange(2028, 2), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(monthRange(2026, 12), { start: '2026-12-01', end: '2026-12-31' });
});

test('shiftMonth: 연도 넘김', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 5, 0), { year: 2026, month: 5 });
});

test('monthLabel', () => {
  assert.equal(monthLabel(2026, 9), '2026년 9월');
});

const txs = [
  { id: 1, kind: 'expense', amount: 12000, category_id: 1, date: '2026-09-03', created_at: '2026-09-03T10:00:00Z' },
  { id: 2, kind: 'expense', amount: 8000,  category_id: 1, date: '2026-09-03', created_at: '2026-09-03T12:00:00Z' },
  { id: 3, kind: 'expense', amount: 5000,  category_id: null, date: '2026-09-01', created_at: '2026-09-01T09:00:00Z' },
  { id: 4, kind: 'income',  amount: 3000000, category_id: 9, date: '2026-09-25', created_at: '2026-09-25T09:00:00Z' },
  { id: 5, kind: 'expense', amount: 30000, category_id: 2, date: '2026-09-10', created_at: '2026-09-10T09:00:00Z' },
];
const cats = [
  { id: 1, name: '식비', kind: 'expense' },
  { id: 2, name: '교통', kind: 'expense' },
  { id: 9, name: '월급', kind: 'income' },
];

test('summarize: 수입·지출·남은 돈', () => {
  assert.deepEqual(summarize(txs), { income: 3000000, expense: 55000, balance: 2945000 });
  assert.deepEqual(summarize([]), { income: 0, expense: 0, balance: 0 });
});

test('sumByCategory: 지출만, 큰 순, 미분류 포함', () => {
  assert.deepEqual(sumByCategory(txs, cats), [
    { id: 2, name: '교통', total: 30000 },
    { id: 1, name: '식비', total: 20000 },
    { id: null, name: '미분류', total: 5000 },
  ]);
});

test('groupByDate: 날짜 내림차순, 같은 날은 최신 먼저', () => {
  const g = groupByDate(txs);
  assert.deepEqual(g.map(x => x.date), ['2026-09-25', '2026-09-10', '2026-09-03', '2026-09-01']);
  assert.deepEqual(g[2].items.map(x => x.id), [2, 1]);
});

test('formatWon / parseWon', () => {
  assert.equal(formatWon(0), '0');
  assert.equal(formatWon(1234567), '1,234,567');
  assert.equal(parseWon('1,234,567'), 1234567);
  assert.equal(parseWon('12abc'), 12);
  assert.equal(parseWon(''), 0);
});
```

- [ ] **Step 2: 실패 확인** — `cd /home/user/junhyeok2 && npm test` → `Cannot find module '../js/calc.js'`
- [ ] **Step 3: 구현** — `js/calc.js`에 위 8개 함수 + `todayLocal()`(로컬 날짜 `YYYY-MM-DD`). 날짜 계산은 `Date.UTC`가 아닌 문자열 조립으로(타임존 영향 없음). 말일은 `new Date(year, month, 0).getDate()`.
- [ ] **Step 4: 통과 확인** — `npm test` → 7 pass
- [ ] Commit: `feat: calc.js 순수 계산 함수와 테스트`

### Task 3: Supabase 스키마

**Files:** Create `supabase/schema.sql`

- [ ] 스펙 4장의 SQL을 한 파일로. 순서: 표 → 인덱스 → RLS·정책 → 트리거 함수·트리거 → realtime publication → 기본 카테고리 insert.
- [ ] 기본 카테고리(sort_order 10 단위): 지출 식비·외식·카페·교통·생활·주거/공과금·의료·쇼핑·여가·기타 / 수입 월급·용돈·기타
- [ ] 파일 맨 위 주석에 "Supabase SQL Editor에 붙여 한 번 실행. 재실행하면 이미 있다는 오류가 나는 것이 정상."
- [ ] 검증: 문법 검사 도구가 없으므로 눈으로 `create policy` 3개, `alter publication` 1개, insert 13행 확인
- [ ] Commit: `feat: Supabase 스키마 SQL`

### Task 4: 공용 모듈 — config, supabase, ui

**Files:** Create `js/config.js`, `js/supabase.js`, `js/ui.js`

- [ ] `config.js`: `export const SUPABASE_URL = ''; export const SUPABASE_ANON_KEY = '';` + 주석(어디서 가져오는지). 빈 값이면 app.js가 설정 안내를 보여준다.
- [ ] `supabase.js`: jsDelivr ESM에서 `createClient` import. `export const sb`, `getSession()`, `signIn(email,pw)`(에러 시 throw), `signOut()`, `onAuthChange(cb)`.
- [ ] `ui.js`: `$(sel, root=document)`, `openSheet(el)/closeSheet(el)`(class `open` 토글 + 배경 클릭 닫기), `toast(msg, ms=2500)`, `confirmDialog(msg)`(window.confirm 래핑), `escapeHtml(s)`.
- [ ] Commit: `feat: 공용 모듈(config, supabase, ui)`

### Task 5: index.html + app.css — 화면 뼈대

**Files:** Create `index.html`, `css/app.css`

- [ ] `index.html` 섹션과 id (js가 이 id들에 의존한다):
  - `#setup-notice` (config 비어 있을 때)
  - `#view-login`: `form#login-form` > `input#login-email`, `input#login-password`, `p#login-error`, `button[type=submit]`
  - `#view-main`: `header` > `h1#page-title`, `button#btn-settings` / `main` > `section#tab-ledger`, `section#tab-todo`, `section#tab-schedule` / `nav.tabbar` > `a[href="#ledger"]`, `a[href="#todo"]`, `a[href="#schedule"]`
  - `#tab-ledger` 내부: `.month-nav` > `button#month-prev`, `span#month-label`, `button#month-next` / `.summary` > `#sum-income`, `#sum-expense`, `#sum-balance` / `details#cat-totals` > `summary` + `ul#cat-totals-list` / `div#tx-list` / `button#btn-add`
  - `#sheet-tx.sheet`: `.sheet-backdrop` + `.sheet-panel` > `form#tx-form` > kind 토글(`input[type=radio][name=kind]` expense/income), `input#tx-amount`(inputmode numeric), `div#tx-cats`(칩), `input#tx-new-cat`(숨김, `+` 칩 누르면 표시), `input#tx-date[type=date]`, `input#tx-memo`, `button#tx-save`, `button#tx-delete`(수정 시만 표시), `input#tx-id[type=hidden]`
  - `#view-settings.overlay`: `button#settings-close`, `input#my-name` + `button#my-name-save`, `div#cat-manage`(expense/income 두 목록. categories.js가 렌더), `button#btn-logout`
  - `#toast`
- [ ] `<head>`: viewport, `theme-color`, `link rel=manifest`, `link rel=icon`, `apple-touch-icon`, CSS. 맨 아래 `<script type="module" src="js/app.js">`.
- [ ] `app.css`: CSS 변수로 색(파란 액센트 `#3b82f6`), `prefers-color-scheme: dark` 대응. 하단 탭바 고정(safe-area), 시트는 `transform: translateY(100%)`→`.open`에서 0, 칩·요약 카드·리스트 행 스타일. `[hidden]{display:none!important}`.
- [ ] 검증: `python3 -m http.server`로 열어 레이아웃만 확인(로직 없음). 콘솔 에러 없어야 함.
- [ ] Commit: `feat: 화면 뼈대와 스타일`

### Task 6: categories.js

**Files:** Create `js/categories.js`

- [ ] export: `fetchCategories()`(sort_order, id 순), `addCategory(name, kind)`(sort_order = 해당 kind 최대+10, 생성 행 반환), `renameCategory(id, name)`, `deleteCategory(id)`, `moveCategory(list, id, dir)`(같은 kind 안에서 이웃과 sort_order 스왑, 두 update), `renderCategoryManager(container, list, {onChanged})`(지출/수입 섹션, 각 행 = 이름(클릭→prompt로 이름 변경) · ▲ · ▼ · 삭제. 삭제는 confirmDialog 후. 변경 후 `onChanged()` 호출)
- [ ] 이름 공백 trim, 빈 문자열이면 무시.
- [ ] Commit: `feat: 카테고리 CRUD와 설정 화면`

### Task 7: ledger.js

**Files:** Create `js/ledger.js`

- [ ] 상태: `{ year, month, txs, cats, profiles }`. `init({ getUser })` 에서 오늘 기준 월 설정, 버튼 바인딩(월 이동·+·시트 폼·삭제).
- [ ] `refresh()`: `categories`, `profiles` 전체 + `transactions` (`date >= start and date <= end`, `order date desc, created_at desc`) 병렬 조회 → `render()`. 실패 시 `#tx-list`에 "불러오지 못했어요" + 다시 시도 버튼.
- [ ] `render()`: `monthLabel`, `summarize` → 요약 3칸(`formatWon`). `sumByCategory` → `#cat-totals-list`. `groupByDate` → 날짜 헤더 + 행. 행: 카테고리명(없으면 미분류) · 메모 · 금액(수입은 `+` + class `income`) · 기록자 이니셜(`profiles`에서 `created_by`로 이름 찾고 첫 글자, 배경 `color`). 행 클릭 → `openTxSheet(tx)`. 비어 있으면 "이번 달 기록이 없어요".
- [ ] 시트: `openTxSheet(tx|null)` — null이면 새 항목(kind expense, 날짜 오늘, 삭제 버튼 숨김). 카테고리 칩은 현재 kind로 필터, kind 토글 바꾸면 칩 다시 그림. `+ 새 카테고리` 칩 → `#tx-new-cat` 표시, Enter/확인 시 `addCategory` → 칩 재렌더 + 선택. 금액 입력은 `parseWon`으로 숫자만 남기고 `formatWon`으로 표시. 금액 0이면 저장 버튼 disabled.
- [ ] 저장: insert 또는 update(`{kind, amount, category_id, date, memo, created_by}`; update 시 created_by는 유지). 성공 → `closeSheet`, `refresh()`. 실패 → 토스트 "저장에 실패했어요. 다시 시도해 주세요", 시트 유지.
- [ ] 삭제: `confirmDialog('이 기록을 삭제할까요?')` → delete → 닫고 refresh. 실패 토스트.
- [ ] 저장/삭제한 월이 현재 보는 월과 다르면(날짜를 바꿔 저장) 그 월로 이동해서 보여준다.
- [ ] Commit: `feat: 가계부 탭`

### Task 8: app.js + PWA

**Files:** Create `js/app.js`, `sw.js`, `manifest.webmanifest`, `icons/icon-192.png`, `icons/icon-512.png`

- [ ] `app.js`:
  1. config 비어 있으면 `#setup-notice`만 보이고 종료.
  2. `getSession()` → 없으면 `#view-login` 표시, 로그인 폼 submit → `signIn` → 성공 시 `enterMain()`; 실패 시 `#login-error` 문구.
  3. `enterMain()`: `#view-main` 표시, `ledger.init`, `ledger.refresh`, 해시 라우팅(`#ledger` 기본; `hashchange`로 탭 섹션 show/hide + 탭 active + 제목), 실시간 채널(`transactions`·`categories` `postgres_changes` `*` → `ledger.refresh()`), `visibilitychange`(visible → refresh), 설정 버튼 → 설정 오버레이(카테고리 매니저 렌더, 내 이름 로드/저장, 로그아웃).
  4. `onAuthChange`: `SIGNED_OUT` → 채널 해제, 로그인 화면.
  5. `navigator.serviceWorker.register('sw.js')`.
- [ ] `sw.js`: install 시 껍데기 파일 목록 캐시(`./`, `index.html`, css, js 전부, manifest, icons). fetch: same-origin GET만 처리, network-first → 실패 시 cache. 캐시 이름에 버전 문자열(`couple-v1`), activate에서 옛 캐시 삭제. Supabase/CDN 요청은 건드리지 않음.
- [ ] `manifest.webmanifest`: name "우리 가계부", short_name "가계부", start_url `./#ledger`, display standalone, background/theme `#3b82f6`, icons 192/512.
- [ ] 아이콘: Python(PIL 있으면 PIL, 없으면 순수 zlib PNG)으로 파란 원 + 흰 ₩ 글자 없이 단색 라운드 사각형 생성. 아이콘은 나중에 바꿔도 됨.
- [ ] 검증: `python3 -m http.server 8000`으로 열어 config 비었을 때 안내 문구 나오는지, 콘솔에 모듈 로드 에러 없는지. 실제 로그인은 Supabase 연결 후.
- [ ] Commit: `feat: 앱 진입점, 실시간, PWA`

### Task 9: 체크리스트 + README 마무리

**Files:** Create `docs/checklist/ledger_v1.html`, Modify `README.md`

- [ ] 체크리스트: 프로젝트 선호 형식(통과/실패/보류 버튼, 진행률, 결과 복사, localStorage 저장, 초기화, 라이트/다크). 항목은 스펙 8장 목록(A 로그인·설치 / B 입력·수정·삭제 / C 카테고리 / D 월·요약 / E 실시간·오프라인).
- [ ] README: 스펙 6장 7단계 그대로 + "개발 중 로컬 확인: `python3 -m http.server 8000`" + `npm test`.
- [ ] Commit: `docs: 수동 체크리스트와 README`

### Task 10: Supabase 연결 후 실제 검증 (사용자 입력 필요)

- [ ] 사용자에게 받은 URL·anon 키를 `js/config.js`에 기입 → Commit `chore: Supabase 연결 정보`
- [ ] Vercel 연결 후 폰에서 체크리스트 A~E 수행. 실패 항목은 체크리스트 "결과 복사"로 받아 수정.

---

## 자체 검토

- 스펙 커버리지: 3.1(T5,T8) 3.2(T5,T8) 3.3(T5,T7) 3.4(T5,T7) 3.5(T5,T6,T8) 3.6(T8) 4장(T3) 5장(전체) 6장(T9) 7장(T7,T8) 8장(T2,T9) — 빠진 항목 없음.
- 함수 이름 일관성: `calc.js` export 9개(`monthRange, shiftMonth, monthLabel, summarize, sumByCategory, groupByDate, formatWon, parseWon, todayLocal`), `categories.js` 6개, `ui.js` 6개, `supabase.js` 5개 — T7·T8이 이 이름을 그대로 쓴다.
