# 우리집 (junhyeok2)

두 사람이 함께 쓰는 모바일 웹앱(PWA). 홈 · 가계부 · 고정비 · 할일 · 스케줄 다섯 탭.
설계: `docs/superpowers/specs/2026-09-05-couple-ledger-design.md`

- 화면: HTML/CSS/JS, 빌드 없음
- 데이터·로그인·실시간: Supabase (무료)
- 호스팅: Vercel (무료)

## 처음 설정 (한 번만)

1. **Supabase 프로젝트 생성** — https://supabase.com → New project (Region: Northeast Asia / Seoul)
2. **표 만들기** — 대시보드 SQL Editor에 `supabase/schema.sql` 전체를 붙여 실행
3. **자가 가입 끄기** — Authentication → Sign In / Up → *Allow new users to sign up* **OFF**
   (끄지 않으면 누구나 계정을 만들어 들어올 수 있다)
4. **두 계정 만들기** — Authentication → Users → *Add user* → 이메일·비밀번호, *Auto Confirm User* 체크.
   표시 이름은 앱 설정 화면에서 바꿀 수 있다.
5. **연결 정보** — Project Settings → API의 *Project URL* 과 *Publishable key*(`sb_publishable_…`, 예전 이름 anon key)를 `js/config.js`에 넣는다
6. **Vercel 배포** — https://vercel.com → Add New Project → GitHub `junhyeok2` import → Framework *Other*, Build/Output 비움 → Deploy.
   이후 `main`에 푸시할 때마다 자동 배포된다.
7. **폰에 설치** — 배포 URL을 크롬으로 열고 ⋮ 메뉴 → *홈 화면에 추가*

## 개발

```bash
npm test                          # 계산 로직 테스트 (node:test)
python3 -m http.server 8000       # 로컬에서 열어보기 → http://localhost:8000
```

`sw.js`는 앱 파일을 캐시한다. 배포 후 화면이 안 바뀌면 `sw.js`의 `CACHE` 버전 문자열을 올린다.

수동 검증 체크리스트: `docs/checklist/ledger_v1.html` (브라우저로 열기)

## 파일

| 경로 | 역할 |
|---|---|
| `index.html` `css/app.css` | 화면 뼈대와 스타일 |
| `js/app.js` | 진입점: 세션 → 화면 전환, 탭, 실시간 구독, 설정 |
| `js/ledger.js` | 가계부 탭 (조회·요약·목록·입력 시트) |
| `js/todo.js` | 할일 탭 (빠른 입력·목록·완료·편집 시트) |
| `js/schedule.js` | 스케줄 탭 (월간 달력·그날 일정·일정 시트) |
| `js/fixed.js` | 고정비 탭 (항목 목록·합계·시트) |
| `js/home.js` | 홈 탭 (이번 달 지출·오늘 일정·할일·고정비 요약) |

동작 메모: 가계부 조회 기간(1·3·6·12개월·직접 지정)은 폰에 기억된다. 뒤로가기는 열린 시트·설정을 먼저 닫고, 없으면 두 번 눌러 종료한다.
| `js/categories.js` | 카테고리 CRUD와 설정 화면 |
| `js/calc.js` | 순수 계산 함수 (`tests/calc.test.js`) |
| `js/supabase.js` `js/config.js` | Supabase 클라이언트와 연결 정보 |
| `js/ui.js` | 시트·토스트 등 공용 조각 |
| `sw.js` `manifest.webmanifest` `icons/` | PWA 설치 |
| `supabase/schema.sql` | DB 표·권한·실시간·기본 카테고리 |
