// 진입점: 설정 확인 → 세션 → 화면 전환, 해시 탭, 실시간 구독, 설정 화면.
import { isConfigured, sb, getSession, signIn, signOut, onAuthChange } from './supabase.js';
import { $, toast, haptic, closeSheet } from './ui.js';
import * as ledger from './ledger.js';
import * as todo from './todo.js';
import * as schedule from './schedule.js';
import * as fixed from './fixed.js';

const APP_VERSION = 'v9'; // sw.js 의 CACHE 버전과 맞춘다
import { fetchCategories, renderCategoryManager } from './categories.js';

const view = {
  setup: $('#setup-notice'),
  login: $('#view-login'),
  main: $('#view-main'),
  settings: $('#view-settings'),
};

const TABS = {
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
  routeHash();
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
  ledger.refresh();
  todo.refresh();
  schedule.refresh();
  fixed.refresh();
}

function subscribeRealtime() {
  if (channel) return;
  channel = sb
    .channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => ledger.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => ledger.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => todo.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => schedule.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fixed_costs' }, () => fixed.refresh())
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
    else ledger.openNew();
  });
}

function currentTab() {
  const name = location.hash.replace('#', '') || 'ledger';
  return TABS[name] ? name : 'ledger';
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
function setupBackGuard() {
  history.pushState({ guard: true }, '', location.href);
  window.addEventListener('popstate', () => {
    // 주소의 # 만 바뀐 것은 탭 이동이다. 가드만 유지하고 넘어간다.
    if (location.hash !== lastHash) {
      lastHash = location.hash;
      if (!history.state?.guard) history.pushState({ guard: true }, '', location.href);
      return;
    }
    // 항상 가드 항목을 다시 올려 둔다. 진짜 종료는 아래에서 history.back() 으로.
    const openSheetEl = document.querySelector('.sheet.open');
    if (openSheetEl) {
      closeSheet(openSheetEl);
      history.pushState({ guard: true }, '', location.href);
      return;
    }
    if (!view.settings.hidden) {
      view.settings.hidden = true;
      ledger.refresh();
      history.pushState({ guard: true }, '', location.href);
      return;
    }
    if (Date.now() - exitArmed < 2000) {
      history.back(); // 가드 아래로 내려가 앱이 닫힌다
      return;
    }
    exitArmed = Date.now();
    toast('뒤로가기를 한 번 더 누르면 종료합니다');
    history.pushState({ guard: true }, '', location.href);
  });
}

// ---- 설정 -----------------------------------------------------------------

function bindSettings() {
  $('#app-version').textContent = `우리집 ${APP_VERSION}`;
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

async function openSettings() {
  view.settings.hidden = false;
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
