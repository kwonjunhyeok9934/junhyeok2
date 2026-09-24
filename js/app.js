// 진입점: 설정 확인 → 세션 → 화면 전환, 해시 탭, 실시간 구독, 설정 화면.
import { isConfigured, sb, getSession, signIn, signOut, onAuthChange } from './supabase.js';
import { $, toast, haptic, closeSheet } from './ui.js';
import * as ledger from './ledger.js';
import * as todo from './todo.js';
import * as schedule from './schedule.js';
import * as fixed from './fixed.js';
import * as home from './home.js';
import * as push from './push.js';
import * as anniv from './anniv.js';
import * as meal from './meal.js';
import * as pantry from './pantry.js';
import * as travel from './travel.js';
import * as trip from './trip.js';
import * as packing from './packing.js';
import * as rules from './rules.js';

import { fetchCategories, renderCategoryManager } from './categories.js';

const view = {
  setup: $('#setup-notice'),
  login: $('#view-login'),
  main: $('#view-main'),
  settings: $('#view-settings'),
};
const overlayTrip = $('#view-trip');

// 화면(탭) 하나하나. 주소의 # 이름이 그대로 키다 — 알림 딥링크(#ledger …)가 계속 열려야 한다.
const TABS = {
  home: { title: '우리집', el: $('#tab-home'), group: 'home' },
  ledger: { title: '가계부', el: $('#tab-ledger'), group: 'money' },
  meal: { title: '식비', el: $('#tab-meal'), group: 'money' },
  fixed: { title: '고정비', el: $('#tab-fixed'), group: 'money' },
  pantry: { title: '사둔것', el: $('#tab-pantry'), group: 'money' },
  schedule: { title: '스케줄', el: $('#tab-schedule'), group: 'plan' },
  todo: { title: '할일', el: $('#tab-todo'), group: 'plan' },
  travel: { title: '지도', el: $('#tab-travel'), group: 'travel' },
  trips: { title: '내 여행', el: $('#tab-trips'), group: 'travel' },
  packing: { title: '준비물', el: $('#tab-packing'), group: 'travel' },
  rule: { title: '규칙', el: $('#tab-rule'), group: 'rule' },
};

// 아래 탭바 다섯 칸. 한 칸 안의 화면은 위쪽 작은 탭으로 옮겨 다닌다.
const GROUPS = {
  home: ['home'],
  money: ['ledger', 'meal', 'fixed', 'pantry'],
  plan: ['schedule', 'todo'],
  travel: ['travel', 'trips', 'packing'],
  rule: ['rule'],
};

// 탭바를 다시 누르면 그 칸에서 마지막으로 보던 화면으로 돌아간다.
const lastSeen = { home: 'home', money: 'ledger', plan: 'schedule', travel: 'travel', rule: 'rule' };

let currentUser = null;
let channels = [];

function show(name) {
  for (const [k, v] of Object.entries(view)) v.hidden = k !== name;
  hideSplash();
}

// 스플래시는 최소 900ms는 보여주고, 첫 화면이 준비되면 사라진다.
const splashStart = performance.now();
let splashHidden = false;
function hideSplash() {
  if (splashHidden) return;
  splashHidden = true;
  const wait = Math.max(0, 700 - (performance.now() - splashStart));
  setTimeout(() => {
    const el = $('#splash');
    el.classList.add('out');
    setTimeout(() => el.remove(), 900);
  }, wait);
}

// ---- 부트 -----------------------------------------------------------------

async function boot() {
  if (!isConfigured) {
    show('setup');
    return;
  }
  bindLogin();
  bindTabs();
  bindSettings();

  const session = await getSession();
  if (session) enterMain(session.user);
  else show('login');

  onAuthChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      leaveMain();
      show('login');
    } else if (event === 'SIGNED_IN' && session && !currentUser) {
      enterMain(session.user);
    }
  });

  watchForUpdate();
  keepStorage();
}

// ---- 새 버전 자동 반영 -------------------------------------------------------
// 홈 화면 아이콘으로 여는 앱은 '주소로 이동'을 하지 않아서, 그냥 두면 브라우저가
// 새 sw.js 를 확인할 기회가 없다. 그래서 며칠이 지나도 옛 화면이 그대로였다.
// 앱을 켤 때와 다시 앞으로 불러올 때마다 새 버전이 있는지 직접 물어본다.
function watchForUpdate() {
  if (!('serviceWorker' in navigator)) return;

  // 처음 설치되는 경우엔 이미 최신이라 새로고침할 것이 없다.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let pending = false;

  navigator.serviceWorker.register('sw.js').then((reg) => {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      reg.update().catch(() => { /* 오프라인이면 다음 기회에 */ });
    };
    check();
    setInterval(check, 30 * 60 * 1000);   // 오래 켜 두는 경우
    document.addEventListener('visibilitychange', () => { check(); applyUpdate(); });
  }).catch((e) => console.warn('sw', e));

  // 새 sw.js 가 자리를 넘겨받은 순간. 화면은 아직 옛 파일로 그려져 있다.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    pending = true;
    applyUpdate();
  });

  // 적고 있는 중에 새로고침하면 쓰던 게 날아간다. 시트가 닫힐 때까지 미룬다.
  function applyUpdate() {
    if (!pending) return;
    if (document.querySelector('.sheet.open')) return;
    pending = false;
    location.reload();
  }
}

// 지금 돌고 있는 버전을 설정 맨 밑에 보여 준다.
//
// 예전에는 여기에 번호를 손으로 적어 두었는데, sw.js 의 CACHE 를 올리면서
// 이쪽을 잊으면 '화면은 새 코드인데 번호는 옛것' 이 되었다. 실제로 그래서
// 업데이트가 안 되는 줄 알고 한참을 헤맸다. 그래서 적어 두지 않고,
// 지금 쓰고 있는 캐시 이름에서 직접 읽는다 — 틀릴 수가 없다.
async function showVersion() {
  const box = $('#app-version');
  if (!box) return;
  let label = '';
  try {
    const nums = (await caches.keys())
      .map((k) => /^couple-v(\d+)$/.exec(k)?.[1])
      .filter(Boolean)
      .map(Number);
    if (nums.length) label = ` v${Math.max(...nums)}`;
  } catch { /* 캐시를 못 보는 환경이면 번호 없이 */ }
  box.textContent = `우리집${label}`;
}

// 브라우저가 저장공간을 알아서 청소하면서 로그인이 풀리는 걸 막는다.
// (사용자가 직접 '사이트 데이터 삭제'를 누르는 건 이걸로도 못 막는다.)
async function keepStorage() {
  try {
    if (!navigator.storage?.persist) return;
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch { /* 무시 */ }
}

// ---- 로그인 ---------------------------------------------------------------

function bindLogin() {
  const form = $('#login-form');
  const err = $('#login-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const email = $('#login-email').value.trim();
      const password = $('#login-password').value;
      const session = await signIn(email, password);
      // 입력칸을 비우기 전에 저장을 부탁한다. 순서가 바뀌면 브라우저가
      // 저장할 게 없다고 보고 '저장할까요?' 를 띄우지 않는다.
      await saveCredential(email, password);
      enterMain(session.user);
    } catch (e2) {
      console.warn(e2);
      err.textContent = loginErrorText(e2);
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}

// 다음에 올 때 한 번에 채워 넣도록 브라우저 비밀번호 관리자에 맡긴다.
// 크롬 계열만 이 방법을 지원하고, 사파리·파이어폭스는 form 의 autocomplete
// 속성을 보고 알아서 저장한다. 그래서 실패해도 그냥 넘어간다.
async function saveCredential(email, password) {
  try {
    if (!window.PasswordCredential || !navigator.credentials?.store) return;
    await navigator.credentials.store(new PasswordCredential({ id: email, password, name: email }));
  } catch { /* 무시 */ }
}

// Supabase 오류 문구를 우리말로. 모르는 문구는 그대로 보여줘서 원인을 찾을 수 있게 한다.
function loginErrorText(e) {
  const m = (e && e.message) || '';
  if (/invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 틀렸어요';
  if (/email not confirmed/i.test(m)) return '계정이 확인(Confirm)되지 않았어요. Supabase Users에서 확인해 주세요';
  if (/logins are disabled|provider is not enabled/i.test(m)) return 'Supabase에서 이메일 로그인이 꺼져 있어요 (Authentication → Providers → Email)';
  if (/failed to fetch|network/i.test(m)) return '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요';
  return m ? `로그인 실패: ${m}` : '로그인에 실패했어요';
}

// ---- 메인 -----------------------------------------------------------------

let firstEnter = true;
function enterMain(user) {
  currentUser = user;
  show('main');
  if (firstEnter) {
    // 앱을 켤 때는 어느 주소로 들어왔든 홈부터 보여준다.
    firstEnter = false;
    history.replaceState(history.state, '', '#home');
  }
  ledger.init({ userId: user.id });
  todo.init({ userId: user.id });
  schedule.init({ userId: user.id });
  fixed.init();
  meal.init({ userId: user.id, onTxChange: () => { ledger.refresh(); home.refresh(); } });
  pantry.init({ userId: user.id });
  travel.init({ userId: user.id });
  trip.init({
    userId: user.id,
    onChange: () => travel.render(),                                   // 여행이 바뀌면 지도도 다시 칠한다
    onTxChange: () => { ledger.refresh(); home.refresh(); },           // 일정에 적은 돈은 가계부로 간다
    onShowRange: (start, end) => { ledger.showRange(start, end); goTab('ledger'); },
    onGo: goTab,
  });
  packing.init({ onChange: () => trip.rerender() });
  rules.init({ userId: user.id });
  home.init({ onGo: goTab });
  routeHash();
  refreshAll();
  subscribeRealtime();
  document.addEventListener('visibilitychange', onVisible);
}

function leaveMain() {
  currentUser = null;
  const pw = $('#login-password');
  if (pw) pw.value = '';
  for (const ch of channels) sb.removeChannel(ch);
  channels = [];
  document.removeEventListener('visibilitychange', onVisible);
}

function refreshAll() {
  home.refresh();
  ledger.refresh();
  todo.refresh();
  schedule.refresh();
  fixed.refresh();
  meal.refresh();
  pantry.refresh();
  travel.refresh();
  trip.refresh();
  packing.refresh();
  rules.refresh();
}

function onVisible() {
  if (document.visibilityState !== 'visible') return;
  refreshAll();
}

function subscribeRealtime() {
  if (channels.length) return;
  const main = sb
    .channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => { ledger.refresh(); home.refresh(); meal.refresh(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => ledger.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => { todo.refresh(); home.refresh(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => { schedule.refresh(); home.refresh(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fixed_costs' }, () => fixed.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'anniversaries' }, () => home.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, () => meal.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_buys' }, () => { meal.refresh(); ledger.refresh(); })
    .subscribe();
  // 여행 표는 나중에 생겼다. 아직 SQL 을 안 돌린 사람도 위 구독은 멀쩡하도록 따로 둔다.
  const travelCh = sb
    .channel('travel-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'visited_regions' }, () => travel.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => trip.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_regions' }, () => trip.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_plans' }, () => { trip.refresh(); ledger.refresh(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_packed' }, () => trip.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'packing_items' }, () => packing.refresh())
    .subscribe();
  // 사 둔 것도 나중에 생겼다 (schema.sql 38번). 같은 이유로 따로 둔다.
  const pantryCh = sb
    .channel('pantry-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pantry_items' }, () => pantry.refresh())
    .subscribe();
  // 규칙도 나중에 생겼다 (schema.sql 43번). 같은 이유로 따로 둔다.
  const ruleCh = sb
    .channel('rule-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rules' }, () => rules.refresh())
    .subscribe();
  channels = [main, travelCh, pantryCh, ruleCh];
}

// ---- 탭 (URL 해시) --------------------------------------------------------

function bindTabs() {
  window.addEventListener('hashchange', routeHash);
  // 탭 이동은 히스토리에 쌓지 않는다 (뒤로가기가 탭을 되감지 않게).
  document.querySelectorAll('.tabbar a').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      goTab(lastSeen[a.dataset.group]);
    }),
  );
  $('#subtabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) goTab(btn.dataset.tab);
  });
  setupBackGuard();
  $('#btn-add').addEventListener('click', () => {
    const tab = currentTab();
    if (tab === 'schedule') schedule.openNew();
    else if (tab === 'fixed') fixed.openNew();
    else if (tab === 'meal') meal.openNew();
    else if (tab === 'pantry') pantry.openNew();
    else if (tab === 'trips' || tab === 'travel') trip.openNew();
    else if (tab === 'rule') rules.openNew();
    // 홈에서 제일 자주 적는 것이 끼니다. 늘 오늘 날짜로 연다.
    else if (tab === 'home') meal.openNew({ today: true });
    else ledger.openNew(); // 가계부는 지출 입력
  });
}

function currentTab(hash = location.hash) {
  const name = hash.replace('#', '') || 'home';
  return TABS[name] ? name : 'home';
}

// 코드에서 탭을 바꿀 때 (홈 카드 등). 히스토리에 쌓지 않는다.
function goTab(name) {
  history.replaceState(history.state, '', '#' + name);
  routeHash();
}

function routeHash() {
  lastHash = location.hash;
  const tab = currentTab();
  const group = TABS[tab].group;
  lastSeen[group] = tab;
  for (const [k, t] of Object.entries(TABS)) {
    const wasHidden = t.el.hidden;
    t.el.hidden = k !== tab;
    if (wasHidden && !t.el.hidden) {
      // 다시 보일 때 등장 애니메이션을 재생한다.
      t.el.style.animation = 'none';
      void t.el.offsetWidth;
      t.el.style.animation = '';
    }
  }
  haptic(5);
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.group === group));
  renderSubtabs(group, tab);
  $('#page-title').textContent = TABS[tab].title;
  $('#btn-add').hidden = tab === 'todo' || tab === 'packing';
}

// 한 칸에 화면이 둘 이상일 때만 위쪽에 작은 탭을 보여준다.
function renderSubtabs(group, tab) {
  const bar = $('#subtabs');
  const names = GROUPS[group];
  bar.hidden = names.length < 2;
  bar.innerHTML = bar.hidden
    ? ''
    : names
        .map(
          (n) =>
            `<button type="button" class="subtab ${n === tab ? 'active' : ''}" data-tab="${n}">${TABS[n].title}</button>`,
        )
        .join('');
}

// ---- 뒤로가기: 열린 것 닫기 → 경고 한 번 → 종료 ------------------------------
//
// 맨 아래 항목(앱을 켤 때의 주소) 위에 가드 항목을 몇 개 쌓아 두고, 뒤로가기가 가드를
// 하나 꺼낼 때마다 popstate 에서 처리한다. 맨 아래까지 내려오면 경고를 띄우고, 거기서
// 한 번 더 누르면 더 내려갈 곳이 없으니 앱이 닫힌다.
//
// 크롬은 사용자가 화면을 건드리지 않은 채 넣은 히스토리 항목을 뒤로가기에서 건너뛴다.
// 뒤로가기를 한 번 누른 뒤에도 다시 건드려야 풀린다. 그래서 popstate 안에서 가드를 다시
// 넣으면 다음 뒤로가기가 그 아래 항목까지 건너뛰어 경고 없이 앱이 닫혔다 (가끔만 되던 이유).
// 가드는 사용자가 누르거나 칠 때만 채우고, 뒤로가기 사이에는 미리 쌓아 둔 것을 쓴다.

const GUARD_DEPTH = 3; // 시트 위에 창이 또 열려 있어도 하나씩 닫고 경고까지 갈 수 있는 개수

function guardDepth() {
  return (history.state && history.state.guard) || 0;
}

let lastHash = location.hash;

function fillGuards() {
  for (let d = guardDepth() + 1; d <= GUARD_DEPTH; d++) {
    history.pushState({ guard: d }, '', '#' + currentTab());
  }
}

// 열려 있는 시트나 창을 하나 닫는다. 닫은 것이 있으면 true.
function closeTopLayer() {
  const openSheetEl = document.querySelector('.sheet.open');
  if (openSheetEl) {
    closeSheet(openSheetEl);
    return true;
  }
  const overlay = document.querySelector('.overlay:not([hidden])');
  if (overlay) {
    if (overlay === overlayTrip) trip.closeDetail();
    else {
      overlay.hidden = true;
      ledger.refresh();
    }
    return true;
  }
  return false;
}

function setupBackGuard() {
  // 브라우저가 "사용자가 건드렸다"고 쳐 주는 이벤트들. 터치는 손을 뗄 때 쳐 준다.
  for (const type of ['pointerup', 'keydown']) {
    document.addEventListener(type, fillGuards, { capture: true, passive: true });
  }

  window.addEventListener('popstate', () => {
    // 뒤로가기로 이전 항목에 내려오면 주소의 # 이 바뀔 수 있다. 보고 있던 탭을 그대로 유지한다.
    // (가드 깊이가 state 에 있으니 state 는 그대로 둔다.)
    const tabHash = '#' + currentTab(lastHash);
    if (location.hash !== tabHash) history.replaceState(history.state, '', tabHash);

    const depth = guardDepth();
    if (closeTopLayer()) {
      // 드물게 가드가 바닥났으면 하나 넣는다. 건드리지 않고 넣은 것이라 크롬이 건너뛸 수는 있다.
      if (depth === 0) history.pushState({ guard: 1 }, '', tabHash);
      return;
    }
    if (depth > 0) {
      // 닫을 것이 없다. 남은 가드를 한 번에 내려가면 맨 아래에서 다시 popstate 가 온다.
      history.go(-depth);
      return;
    }
    // 맨 아래. 여기서 한 번 더 누르면 앱이 닫힌다. 그 사이에 화면을 건드리면 가드가 다시 채워진다.
    toast('뒤로가기를 한 번 더 누르면 앱을 나갑니다');
  });
}

// ---- 설정 -----------------------------------------------------------------

function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#101214' : '#3182f6';
}

function bindTheme() {
  let theme = 'system';
  try { theme = localStorage.getItem('theme') || 'system'; } catch { /* 무시 */ }
  applyTheme(theme);
  const input = document.querySelector(`#theme-seg input[value="${theme}"]`);
  if (input) input.checked = true;
  $('#theme-seg').addEventListener('change', (e) => {
    const v = e.target.value;
    try { localStorage.setItem('theme', v); } catch { /* 무시 */ }
    applyTheme(v);
    haptic(5);
  });
}

// 설정은 한 번에 한 칸만 보여 준다. 마지막으로 본 칸을 기억했다가 다시 열면 거기로 간다.
let settingsSec = 'name';
function showSettingsSec(sec) {
  settingsSec = sec;
  for (const b of document.querySelectorAll('#settings-tabs [data-sec]')) {
    b.classList.toggle('active', b.dataset.sec === sec);
  }
  for (const box of document.querySelectorAll('#view-settings section[data-sec]')) {
    box.hidden = box.dataset.sec !== sec;
  }
}

function bindSettings() {
  showVersion();
  bindTheme();
  bindPush();
  $('#settings-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sec]');
    if (!b || b.dataset.sec === settingsSec) return;
    showSettingsSec(b.dataset.sec);
    haptic();
  });
  showSettingsSec(settingsSec);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', () => {
    view.settings.hidden = true;
    ledger.refresh();
    home.refresh();
  });
  $('#btn-logout').addEventListener('click', async () => {
    view.settings.hidden = true;
    await signOut();
  });
  $('#my-name-save').addEventListener('click', async () => {
    const name = $('#my-name').value.trim();
    if (!name) return;
    const { error } = await sb.from('profiles').update({ name }).eq('id', currentUser.id);
    if (error) {
      console.error(error);
      toast('이름을 저장하지 못했어요');
      return;
    }
    toast('저장했어요');
  });
}

async function renderPush() {
  const stateEl = $('#push-state');
  const toggle = $('#push-toggle');
  const test = $('#push-test');
  const state = await push.getState();
  const text = { unsupported: '이 브라우저는 알림을 지원하지 않아요', denied: '알림이 차단돼 있어요. 폰 설정에서 이 앱의 알림을 허용해 주세요', on: '이 폰에서 알림 받는 중', off: '이 폰은 알림이 꺼져 있어요' };
  stateEl.textContent = text[state];
  toggle.hidden = state === 'unsupported' || state === 'denied';
  toggle.textContent = state === 'on' ? '알림 끄기' : '알림 켜기';
  toggle.classList.toggle('primary', state !== 'on');
  test.hidden = state !== 'on';
}

function bindPush() {
  $('#push-toggle').addEventListener('click', async () => {
    const btn = $('#push-toggle');
    btn.disabled = true;
    try {
      if ((await push.getState()) === 'on') {
        await push.disable();
        toast('알림을 꺼요');
      } else {
        await push.enable(currentUser.id);
        toast('알림을 켰어요');
        haptic(15);
      }
    } catch (err) {
      console.error(err);
      toast(err.message === 'permission' ? '알림 권한을 허용해 주세요' : '알림 설정에 실패했어요');
    } finally {
      btn.disabled = false;
      renderPush();
    }
  });
  $('#push-test').addEventListener('click', () => push.testLocal().catch((e) => { console.error(e); toast('알림을 띄우지 못했어요'); }));
}

async function openSettings() {
  view.settings.hidden = false;
  showVersion();   // 처음 켠 직후에는 캐시가 아직 없을 수 있어 열 때마다 다시 본다
  renderPush();
  const { data } = await sb.from('profiles').select('name').eq('id', currentUser.id).maybeSingle();
  $('#my-name').value = data?.name ?? '';
  anniv.renderManager($('#anniv-manage'));
  await renderCats();
}

async function renderCats() {
  try {
    const list = await fetchCategories();
    renderCategoryManager($('#cat-manage'), list, {
      onChanged: renderCats,
      onError: (_err, msg) => toast(msg ?? '변경에 실패했어요. 다시 시도해 주세요'),
    });
  } catch (err) {
    console.error(err);
    toast('카테고리를 불러오지 못했어요');
  }
}

boot();
