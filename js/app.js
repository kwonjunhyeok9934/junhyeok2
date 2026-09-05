// 진입점: 설정 확인 → 세션 → 화면 전환, 해시 탭, 실시간 구독, 설정 화면.
import { isConfigured, sb, getSession, signIn, signOut, onAuthChange } from './supabase.js';
import { $, toast } from './ui.js';
import * as ledger from './ledger.js';
import { fetchCategories, renderCategoryManager } from './categories.js';

const view = {
  setup: $('#setup-notice'),
  login: $('#view-login'),
  main: $('#view-main'),
  settings: $('#view-settings'),
};

const TABS = {
  ledger: { title: '가계부', el: $('#tab-ledger') },
  todo: { title: '할일', el: $('#tab-todo') },
  schedule: { title: '스케줄', el: $('#tab-schedule') },
};

let currentUser = null;
let channel = null;

function show(name) {
  for (const [k, v] of Object.entries(view)) v.hidden = k !== name;
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
  routeHash();
  ledger.refresh();
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
  if (document.visibilityState === 'visible') ledger.refresh();
}

function subscribeRealtime() {
  if (channel) return;
  channel = sb
    .channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => ledger.refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => ledger.refresh())
    .subscribe();
}

// ---- 탭 (URL 해시) --------------------------------------------------------

function bindTabs() {
  window.addEventListener('hashchange', routeHash);
}

function routeHash() {
  const name = location.hash.replace('#', '') || 'ledger';
  const tab = TABS[name] ? name : 'ledger';
  for (const [k, t] of Object.entries(TABS)) t.el.hidden = k !== tab;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  $('#page-title').textContent = TABS[tab].title;
  $('#btn-add').hidden = tab !== 'ledger';
}

// ---- 설정 -----------------------------------------------------------------

function bindSettings() {
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
