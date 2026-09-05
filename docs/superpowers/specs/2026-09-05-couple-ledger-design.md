# 부부 앱 — 1차: 공통 뼈대 + 가계부 설계

작성일: 2026-09-05

## 1. 목적과 범위

두 사람(부부)이 함께 쓰는 모바일 앱. 최종 기능은 **가계부 · 할일 · 스케줄** 세 가지이며,
이 문서는 **1차 범위 = 공통 뼈대 + 가계부**를 다룬다. 할일·스케줄은 각각 별도 스펙으로 진행한다.

### 제약

- 사용자 2명, 둘 다 안드로이드.
- 서버를 직접 운영하지 않는다. 비용 0원.
- "간단하게". 기능보다 유지·수정이 쉬운 쪽을 택한다.

### 성공 기준

1. 두 사람 각자 폰 홈 화면에 앱 아이콘이 있고, 누르면 바로 가계부가 열린다.
2. 한 사람이 거래를 저장하면 다른 사람 화면에 새로고침 없이 나타난다.
3. 이번 달 수입·지출·남은 돈과 카테고리별 지출 합계가 보인다.
4. 카테고리를 앱 안에서 추가·이름 변경·삭제할 수 있다.
5. 두 계정 외에는 링크를 알아도 데이터를 볼 수 없다.

### 1차에서 뺀 것

예산 설정, 차트, 반복 지출, 사진 첨부, 검색, 내보내기, 자가 가입, 비밀번호 재설정 화면.
필요해지면 별도로 추가한다.

## 2. 기술 선택

| 항목 | 선택 | 이유 |
|---|---|---|
| 앱 형태 | PWA (웹앱) | 링크만 보내면 설치, 스토어·APK 불필요, 업데이트 자동 |
| 화면 | HTML + CSS + JS, 빌드 도구 없음 | 저장소 파일 = 배포 파일. 고장 지점 최소 |
| 데이터/인증 | Supabase 무료 플랜 | 관리형 Postgres + 로그인 + 실시간. 서버 운영 불필요 |
| 호스팅 | Vercel 무료 | GitHub 푸시마다 자동 배포. 비공개 저장소 무료 |
| Supabase 클라이언트 | CDN (`@supabase/supabase-js` v2, ESM) | npm 없이 사용 |

대안으로 검토한 것: Vite+Svelte(지금 규모엔 관리 부담이 이득보다 큼),
구글 스프레드시트 DB(로그인·실시간 약함), Expo/Flutter(네이티브 기능 불필요, 아이폰 없음이어도 배포 부담).

## 3. 화면과 흐름

### 3.1 로그인

- 이메일·비밀번호 입력 + 로그인 버튼. 가입 화면 없음.
- 실패 시 입력칸 아래에 "이메일 또는 비밀번호가 틀렸어요".
- 성공 시 세션은 Supabase가 localStorage에 보관 → 다음 실행부터 자동 로그인.

### 3.2 메인 껍데기

- 상단: 현재 탭 제목 + 오른쪽 ⚙(설정).
- 하단 탭 3개: **가계부 · 할일 · 스케줄**. 1차에서는 가계부만 동작, 나머지 탭은 "준비 중" 문구.
- 탭은 URL 해시(`#ledger`, `#todo`, `#schedule`)로 구분해 뒤로가기와 새로고침에도 유지.

### 3.3 가계부 탭

위에서부터:

1. **월 이동** `◀ 2026년 9월 ▶`. 기본값 이번 달.
2. **요약 카드**: 수입 / 지출 / 남은 돈(수입−지출). 해당 월 기준.
3. **카테고리별 지출 합계**: 접을 수 있는 목록. 금액 큰 순. 기본 접힘.
4. **거래 목록**: 날짜별로 묶음(최신 날짜 위). 한 줄 = `카테고리 · 메모 · 금액 · 기록자 이니셜 동그라미`.
   지출은 기본 글자색, 수입은 파란색 + 앞에 `+`.
5. 오른쪽 아래 **+ 버튼** → 입력 시트.

거래가 없는 달: "이번 달 기록이 없어요" 한 줄.

### 3.4 입력 시트 (아래에서 올라오는 패널)

- `지출 | 수입` 토글 (기본 지출).
- 금액: `inputmode="numeric"`, 천 단위 콤마 표시.
- 카테고리 칩 목록(현재 토글의 kind에 맞는 것만) + 맨 끝 `+ 새 카테고리` 칩.
  `+`를 누르면 이름 입력칸이 열리고, 확인 시 즉시 추가되며 선택 상태가 된다.
- 날짜: `<input type="date">`, 기본값 오늘.
- 메모: 한 줄 텍스트, 선택.
- **저장** 버튼. 금액이 0이거나 비어 있으면 저장 비활성. 카테고리 미선택 저장 허용(category_id = null, "미분류"로 표시).
- 기존 거래를 누르면 같은 시트가 값이 채워진 채 열리고 **삭제** 버튼이 추가로 보인다. 삭제는 확인창 한 번.

### 3.5 설정

- 카테고리 관리: 지출/수입 각각 목록. 이름 수정(인라인), 삭제(확인창), 위·아래 순서 이동 버튼.
  카테고리를 삭제해도 그 카테고리를 쓰던 거래는 남고 "미분류"가 된다.
- 내 이름: profiles.name 수정(이니셜 표시용).
- 로그아웃.

### 3.6 실시간 반영

`transactions`, `categories`의 INSERT/UPDATE/DELETE를 구독한다.
변경이 오면 전체를 다시 그리지 않고 현재 월 데이터를 **재조회**해서 그린다
(데이터 양이 작아 단순함이 이득).

## 4. 데이터 설계 (Supabase / Postgres)

금액은 원 단위 **정수**(`integer`). 날짜는 `date` (시간 없음, 사용자 폰의 로컬 날짜를 저장).

### 4.1 테이블

```sql
-- 사용자 표시 정보. auth.users 에 계정이 생기면 트리거로 자동 생성.
create table profiles (
  id    uuid primary key references auth.users(id) on delete cascade,
  name  text not null,          -- 기본값: 이메일 @ 앞부분
  color text not null default '#3b82f6'
);

create table categories (
  id         bigint generated always as identity primary key,
  name       text not null,
  kind       text not null check (kind in ('expense','income')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table transactions (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('expense','income')),
  amount      integer not null check (amount > 0),
  category_id bigint references categories(id) on delete set null,
  date        date not null,
  memo        text not null default '',
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);
create index on transactions (date);
```

### 4.2 접근 제어 (RLS)

세 표 모두 RLS를 켜고, 정책은 하나: **로그인한 사용자(`authenticated`)는 모든 행을 읽고 쓸 수 있다.**
두 사람이 모든 데이터를 공유하는 앱이므로 행 단위 소유권 구분은 두지 않는다.

```sql
alter table profiles     enable row level security;
alter table categories   enable row level security;
alter table transactions enable row level security;

create policy "auth all" on profiles     for all to authenticated using (true) with check (true);
create policy "auth all" on categories   for all to authenticated using (true) with check (true);
create policy "auth all" on transactions for all to authenticated using (true) with check (true);
```

추가로 Supabase 대시보드에서 **Authentication → Sign In / Up → "Allow new users to sign up" 끄기**.
이걸 끄지 않으면 anon 키만으로 누구나 계정을 만들어 로그인할 수 있다. 이 설정이 보안의 핵심이다.

### 4.3 트리거

```sql
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

### 4.4 실시간

```sql
alter publication supabase_realtime add table transactions, categories;
```

### 4.5 초기 데이터

`schema.sql` 마지막에 기본 카테고리를 넣어 둔다. 앱에서 언제든 바꿀 수 있다.

- 지출: 식비, 외식, 카페, 교통, 생활, 주거/공과금, 의료, 쇼핑, 여가, 기타
- 수입: 월급, 용돈, 기타

### 4.6 anon 키 노출에 대해

빌드 단계가 없으므로 `js/config.js`에 SUPABASE_URL과 anon 키가 그대로 들어가고 저장소에도 커밋된다.
anon 키는 브라우저에 노출되는 것을 전제로 설계된 공개 키이며, 데이터 보호는 RLS(4.2)와
자가 가입 차단이 담당한다. **service_role 키는 어디에도 넣지 않는다.**

## 5. 파일 구조

```
index.html                  화면 뼈대 전체 (로그인·탭·가계부·입력 시트·설정). 화면은 섹션 show/hide
manifest.webmanifest        앱 이름·아이콘·standalone
sw.js                       앱 껍데기 캐시(network-first). Supabase 요청은 캐시하지 않음
icons/icon-192.png
icons/icon-512.png
css/app.css
js/config.js                SUPABASE_URL, SUPABASE_ANON_KEY
js/supabase.js              클라이언트 생성, signIn/signOut/getSession, 현재 사용자
js/app.js                   진입점. 세션 확인 → 로그인/메인 전환, 해시 탭 라우팅, 실시간 구독 시작
js/ledger.js                가계부 탭: 월 이동, 조회, 요약·목록 렌더, 입력 시트 열기/저장/삭제
js/categories.js            categories 조회/추가/수정/삭제/순서, 설정 화면 렌더
js/calc.js                  순수 함수: 월 범위, 요약 합계, 카테고리별 합계, 날짜별 묶기, 금액 포맷
js/ui.js                    시트 열기/닫기, 토스트, 확인창, 작은 DOM 헬퍼
supabase/schema.sql         4장의 SQL 전체. Supabase SQL Editor에 붙여 한 번 실행
tests/calc.test.js          node:test 로 calc.js 검증
docs/checklist/ledger_v1.html  수동 검증용 HTML 체크리스트 (8장)
README.md                   설치·배포 순서 (6장)
```

각 js 파일은 ES 모듈. `index.html`에서 `app.js` 하나만 `type="module"`로 불러온다.

### 모듈 경계

- `calc.js`는 DOM·Supabase를 모른다. 입력은 배열, 출력은 값. 테스트 대상.
- `ledger.js`, `categories.js`는 Supabase 조회와 자기 화면 렌더만 한다. 서로 직접 호출하지 않고 `app.js`가 이어 준다.
- `ui.js`는 어느 화면에도 속하지 않는 공용 조각만 둔다.

## 6. 배포와 초기 설정 (README에 그대로 실림)

1. Supabase 프로젝트 생성 (Region: Northeast Asia/Seoul).
2. SQL Editor에 `supabase/schema.sql` 붙여 실행.
3. Authentication → Sign In / Up → "Allow new users to sign up" **끄기**.
4. Authentication → Users → "Add user"로 두 계정 생성 (이메일 확인 자동 체크). User Metadata에 `{"name":"이름"}` 넣으면 그 이름이 표시됨.
5. Project Settings → API에서 URL과 anon 키를 `js/config.js`에 기입.
6. Vercel에서 GitHub 저장소 `junhyeok2` import. Framework: Other, Build 없음, Output: 루트.
7. 배포 URL을 폰 크롬에서 열고 → 메뉴 → "홈 화면에 추가".

## 7. 에러 처리

| 상황 | 동작 |
|---|---|
| 저장/삭제 실패 (네트워크 등) | 시트를 닫지 않고 토스트 "저장에 실패했어요. 다시 시도해 주세요". 입력값 유지 |
| 조회 실패 | 목록 자리에 "불러오지 못했어요" + 다시 시도 버튼 |
| 세션 만료·로그아웃 | 로그인 화면으로 전환 |
| 오프라인 | 앱 껍데기는 sw 캐시로 열림. 데이터 조회 실패 시 위 규칙 적용. 오프라인 저장/큐는 하지 않음 |
| 실시간 끊김 | `visibilitychange`로 앱이 다시 앞에 오면 현재 월 재조회 |

## 8. 검증

- **자동**: `node --test tests/` — `calc.js`의 월 요약, 카테고리 합계(미분류 포함), 날짜 묶기·정렬, 금액 포맷.
- **수동**: `docs/checklist/ledger_v1.html` (프로젝트에서 쓰던 형식의 HTML 체크리스트). 항목:
  로그인 성공/실패, 자동 로그인 유지, 홈 화면 추가, 지출·수입 저장, 수정, 삭제, 카테고리 추가/이름변경/삭제(미분류 전환 확인),
  월 이동, 요약 합계 일치, 상대 폰 실시간 반영, 로그아웃, 오프라인에서 앱 열림.

## 9. 다음 단계 (이 스펙 밖)

- 2차: 할일 탭 — 별도 스펙.
- 3차: 스케줄 탭 — 별도 스펙.
- 뼈대(탭·로그인·실시간·ui.js)는 그대로 재사용한다.
