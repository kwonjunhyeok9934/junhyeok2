// 진입점: 설정 확인 → 세션 → 화면 전환, 해시 탭, 실시간 구독, 설정 화면.
import { isConfigured, sb, getSession, signIn, signOut, onAuthChange } from './supabase.js';
import { $, toast, haptic, closeSheet } from './ui.js';
import * as ledger from './ledger.js';
import * as todo from './todo.js';
import * as schedule from './schedule.js';
import * as fixed from './fixed.js';
import * as home from './home.js';
import * as push from './push.js';

const APP_VERSION = 'v13'; // sw.js 의 CACHE 버전과 맞춘다
import { fetchCategories, renderCategoryManager } from './categories.js';

const view = {
  setup: $('#setup-notice'),
  login: $('#view-login'),
  main: $('#view-main'),
  settings: $('#view-settings'),
};

const TABS = {
  home: { title: '우리집', el: $('#tab-home') },
  ledger: { title: '가계부', el: $('#tab-ledger') },
  fixed: { title: '고정비', el: $('#tab-fixed') },
  todo: { title: '할일', el: $('#tab-todo') },
  schedule: { title: '스케줄', el: $('#tab-schedule') },
};

let currentUser = null;
let channel = null;

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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e));
  }
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
      const session = await signIn($('#login-email').value.trim(), $('#login-password').value);
      form.reset();
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

function enterMain(user) {
  currentUser = user;
  show('main');
  ledger.init({ userId: user.id });
  todo.init({ userId: user.id });
  schedule.init({ userId: user.id });
  fixed.init();
  home.init({ onGo: goTab });
  routeHash();
  home.refresh();
  ledger.refresh();
  todo.refresh();
  schedule.refresh();
  fixed.refresh();
  subscribeRealtime();
  document.addEventListener('visibilitychange', onVisible);
}

function leaveMain() {
  currentUser = null;
  if (channel) {
    sb.removeChannel(channel);
    channel = null;
  }
  document.removeEventListener('visibilitychange', onVisible);
}

function onVisible() {
  if (document.visibilityState !== 'visible') return;
  home.refresh();
  ledger.refresh();
  todo.refresh();
  schedule.refresh();
  fixed.refresh();
}

function subscribeRealtime() {
  if (channel) return;
  channel = sb
    .channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => { ledger.refresh(); home.refresh(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => ledger.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => { todo.refresh(); home.refresh(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => { schedule.refresh(); home.refresh(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fixed_costs' }, () => { fixed.refresh(); home.refresh(); })
    .subscribe();
}

// ---- 탭 (URL 해시) --------------------------------------------------------

function bindTabs() {
  window.addEventListener('hashchange', routeHash);
  // 탭 이동은 히스토리에 쌓지 않는다 (뒤로가기가 탭을 되감지 않게).
  document.querySelectorAll('.tabbar a').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      history.replaceState(history.state, '', a.getAttribute('href'));
      routeHash();
    }),
  );
  setupBackGuard();
  $('#btn-add').addEventListener('click', () => {
    const tab = currentTab();
    if (tab === 'schedule') schedule.openNew();
    else if (tab === 'fixed') fixed.openNew();
    else ledger.openNew(); // 홈·가계부는 지출 입력
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
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  $('#page-title').textContent = TABS[tab].title;
  $('#btn-add').hidden = tab === 'todo';
}

// ---- 뒤로가기: 열린 것 닫기 → 두 번 눌러 종료 ----------------------------------

let exitArmed = 0;
let lastHash = location.hash;
let guardArmed = false;

// 크롬은 사용자가 화면을 건드리기 전에 앱이 넣은 히스토리 항목을 뒤로가기에서 무시한다.
// 그래서 첫 터치 직후에 가드 항목을 넣는다.
function armGuard() {
  if (guardArmed) return;
  guardArmed = true;
  history.pushState({ guard: true }, '', '#' + currentTab());
}

function setupBackGuard() {
  document.addEventListener('pointerdown', armGuard, { once: true, capture: true });

  window.addEventListener('popstate', () => {
    // 뒤로가기로 이전 항목에 내려오면 주소의 # 이 바뀔 수 있다. 보고 있던 탭을 그대로 유지한다.
    const tabHash = '#' + currentTab(lastHash);
    if (location.hash !== tabHash) history.replaceState(null, '', tabHash);

    const openSheetEl = document.querySelector('.sheet.open');
    if (openSheetEl) {
      closeSheet(openSheetEl);
      history.pushState({ guard: true }, '', tabHash);
      return;
    }
    if (!view.settings.hidden) {
      view.settings.hidden = true;
      ledger.refresh();
      history.pushState({ guard: true }, '', tabHash);
      return;
    }
    if (Date.now() - exitArmed < 2000) {
      history.back(); // 가드 아래로 내려가 앱이 닫힌다
      return;
    }
    exitArmed = Date.now();
    toast('뒤로가기를 한 번 더 누르면 종료합니다');
    history.pushState({ guard: true }, '', tabHash);
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

function bindSettings() {
  $('#app-version').textContent = `우리집 ${APP_VERSION}`;
  bindTheme();
  bindPush();
  $('#btn-settings').addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', () => {
    view.settings.hidden = true;
    ledger.refresh();
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
  renderPush();
  const { data } = await sb.from('profiles').select('name').eq('id', currentUser.id).maybeSingle();
  $('#my-name').value = data?.name ?? '';
  await renderCats();
}

async function renderCats() {
  try {
    const list = await fetchCategories();
    renderCategoryManager($('#cat-manage'), list, {
      onChanged: renderCats,
      onError: () => toast('변경에 실패했어요. 다시 시도해 주세요'),
    });
  } catch (err) {
    console.error(err);
    toast('카테고리를 불러오지 못했어요');
  }
}

boot();
