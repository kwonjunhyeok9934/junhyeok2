// 사 둔 것 탭: 윙잇·컬리·쿠팡·마트·편의점에서 산 품목을 미리 담아 둔다.
// 담을 때는 가계부에 안 들어간다 — 식비에서 처음 꺼내 먹을 때 한 번만 값이 실린다(js/meal.js).
// 목록의 원본이 여기라, 식비 탭은 items() 로 가져다 드롭다운을 만든다.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic, animateNumber } from './ui.js';
import { todayLocal, shiftDay, formatWon, howNeedsShop, groupPantryByHow, pantryStats, tagColor } from './calc.js';
import { fetchCategories } from './categories.js';
import { itemRowHtml, growItemRows, readFreeRow, onItemRowsKeydown } from './itemrow.js';

const PLACEHOLDER = '품목 (예: 삼겹살)';

const state = {
  items: [],       // 남은 것 전부 + 최근에 다 쓴 것
  cats: [],
  userId: null,
  error: null,     // 31번 SQL 을 아직 안 돌렸으면 여기 담긴다
  showDone: false,
  editing: null,   // 고치는 중인 품목, 새로 담는 중이면 null
  howId: null,
};

let el = null;
let initialized = false;

export function init({ userId }) {
  state.userId = userId;
  if (initialized) return;
  initialized = true;

  el = {
    left: $('#pantry-left'), waiting: $('#pantry-waiting'), list: $('#pantry-list'),
    notice: $('#pantry-notice'), listHead: $('#pantry-list-head'), doneToggle: $('#pantry-done-toggle'),
    sheet: $('#sheet-pantry'), form: $('#pantry-form'), hows: $('#pantry-hows'), date: $('#pantry-date'),
    rows: $('#pantry-items'), total: $('#pantry-total'), charged: $('#pantry-charged'),
    save: $('#pantry-save'), del: $('#pantry-delete'),
  };

  bindSheetBackdrop(el.sheet);
  el.list.addEventListener('click', onListClick);
  el.doneToggle.addEventListener('click', () => {
    state.showDone = !state.showDone;
    render();
  });
  el.hows.addEventListener('click', onHowClick);
  el.rows.addEventListener('input', onRowsInput);
  el.rows.addEventListener('click', onRowsClick);
  el.rows.addEventListener('keydown', onItemRowsKeydown);
  el.form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  el.del.addEventListener('click', remove);
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

// 아직 31번 SQL 을 실행하지 않아 표가 없는 상태인지.
function needsSql(err) {
  const m = `${err?.message ?? ''} ${err?.code ?? ''}`;
  return /does not exist|could not find the table|42P01|PGRST205/i.test(m);
}

const sheetOpen = () => el?.sheet.classList.contains('open');

// ---- 조회 ------------------------------------------------------------------

// 실패해도 던지지 않는다 — 31번 SQL 을 아직 안 돌린 사람도 식비 탭은 멀쩡해야 한다.
export async function load() {
  if (!initialized) return;
  try {
    const [cats, items] = await Promise.all([
      fetchCategories(),
      sb
        .from('pantry_items')
        .select('id,how_id,name,amount,bought_on,charged_buy_id,done')
        // 남은 것은 전부, 다 쓴 것은 최근 두 달치만 (목록이 끝없이 길어지지 않게).
        .or(`done.eq.false,bought_on.gte.${shiftDay(todayLocal(), -60)}`)
        .order('bought_on', { ascending: false })
        .order('id', { ascending: false })
        .then(unwrap),
    ]);
    state.cats = cats;
    state.items = items;
    state.error = null;
  } catch (err) {
    console.error(err);
    state.items = [];
    state.error = err;
  }
}

export async function refresh() {
  if (!initialized || sheetOpen()) return; // 담는 중에는 다시 그리지 않는다
  await load();
  render();
}

// 식비 탭이 드롭다운을 만들 때 쓴다.
export const items = () => state.items;

// ---- 목록 화면 --------------------------------------------------------------

const catsOf = (kind) => state.cats.filter((c) => c.kind === kind);
const mdLabel = (date) => `${Number(String(date ?? '').slice(5, 7))}/${Number(String(date ?? '').slice(8, 10))}`;

// 배달·포장·외식은 갈 때마다 가게가 달라 담아 둘 것이 없다. 나머지(윙잇·컬리·쿠팡·마트·편의점)만.
const pantryHows = () => catsOf('meal_how').filter((c) => !howNeedsShop(c.name));

function render() {
  if (state.error) {
    el.list.innerHTML = '';
    el.listHead.hidden = true;
    el.doneToggle.hidden = true;
    el.waiting.hidden = true;
    el.notice.hidden = false;
    el.notice.innerHTML = needsSql(state.error)
      ? `<p class="empty">사 둔 것 표가 아직 준비되지 않았어요.<br>Supabase SQL Editor 에서<br><code>schema.sql</code> 의 31번 섹션을 실행해 주세요.</p>`
      : `<div class="retry">불러오지 못했어요<br>
          <button type="button" class="btn small" data-retry>다시 시도</button>
        </div>`;
    return;
  }
  el.notice.hidden = true;
  el.listHead.hidden = false;

  const stats = pantryStats(state.items);
  animateNumber(el.left, stats.left, (n) => `${n}개`);
  el.waiting.hidden = !stats.waiting;
  el.waiting.textContent = `${formatWon(stats.waiting)}원은 식비에서 처음 꺼내 먹을 때 가계부에 들어가요`;
  el.doneToggle.hidden = !stats.done;
  el.doneToggle.textContent = state.showDone ? '다 쓴 것 숨기기' : `다 쓴 것 ${stats.done}개 보기`;

  const shown = state.items.filter((it) => !it.done || state.showDone);
  const groups = groupPantryByHow(shown, state.cats);
  let i = 0;
  el.list.innerHTML = groups.length
    ? groups
        .map(
          (g) => `
      <div class="card day-card">
        <div class="day-head">
          <span>${escapeHtml(g.name)}</span>
          <span class="sub">${g.total ? formatWon(g.total) : ''}</span>
        </div>
        ${g.items.map((it) => rowHtml(it, i++)).join('')}
      </div>`,
        )
        .join('')
    : `<p class="empty">아직 담아 둔 게 없어요<br>윙잇·컬리에서 시킨 걸 담아 두면<br>식비에서 꺼내 쓸 수 있어요</p>`;
}

function rowHtml(it, i) {
  const how = catsOf('meal_how').findIndex((c) => c.id === it.how_id);
  return `
    <div class="tx-row pantry-row${it.done ? ' done' : ''}" data-pantry="${it.id}" style="--i:${Math.min(i, 12)}">
      <span class="tag how" style="${tint(tagColor(how))}">${escapeHtml(mdLabel(it.bought_on))}</span>
      <div class="tx-main">
        <div class="tx-cat">${escapeHtml(it.name)}</div>
        <div class="tx-memo">${it.charged_buy_id ? '가계부에 들어감' : '아직 안 들어감'}</div>
      </div>
      <span class="tx-amount">${it.amount ? formatWon(it.amount) : ''}</span>
      <button type="button" class="chip mini${it.done ? ' selected' : ''}" data-act="toggle">${it.done ? '다 씀' : '남김'}</button>
    </div>`;
}

// 뱃지: 그 색을 옅게 깐 배경 + 진한 글자 (식비 탭과 같은 방식).
function tint(color) {
  const c = escapeHtml(color);
  return `background:color-mix(in srgb, ${c} 15%, transparent); color:${c}`;
}

function onListClick(e) {
  if (e.target.closest('[data-retry]')) { refresh(); return; }
  const row = e.target.closest('[data-pantry]');
  if (!row) return;
  const item = state.items.find((p) => p.id === Number(row.dataset.pantry));
  if (!item) return;
  if (e.target.closest('[data-act="toggle"]')) toggleDone(item);
  else openSheetFor(item);
}

// 목록에서 바로 남김 ↔ 다 씀. 손으로 누른 것이라 어느 세트의 것도 아니게 둔다.
async function toggleDone(item) {
  const done = !item.done;
  item.done = done;
  render();
  if (done) haptic(15);
  try {
    unwrap(await sb.from('pantry_items').update({ done, done_buy_id: null }).eq('id', item.id));
  } catch (err) {
    console.error(err);
    item.done = !done;
    render();
    toast('변경에 실패했어요. 다시 시도해 주세요');
  }
}

// ---- 담기·고치기 시트 ---------------------------------------------------------

export function openNew() {
  openSheetFor(null);
}

// item 이 없으면 새로 담기(여러 줄), 있으면 그 품목 하나를 고친다.
function openSheetFor(item) {
  state.editing = item ?? null;
  state.howId = item?.how_id ?? pantryHows()[0]?.id ?? null;
  el.date.value = item?.bought_on ?? todayLocal();
  el.del.hidden = !item;
  el.charged.hidden = !item?.charged_buy_id;
  renderHows();
  el.rows.innerHTML = item
    ? editRowHtml(item)
    : itemRowHtml({ name: '', amount: 0 }, { last: true, placeholder: PLACEHOLDER });
  recalcTotal();
  updateSaveState();
  openSheet(el.sheet);
  if (!item) setTimeout(() => el.rows.querySelector('[data-role="name"]')?.focus(), 250);
}

// 이미 가계부로 넘어간 품목은 가격 칸이 잠긴다 —
// 그 끼니의 품목 줄이 원본이라 여기서 바꾸면 둘이 어긋난다.
function editRowHtml(item) {
  return `
    <div class="row">
      <input type="text" data-role="name" placeholder="${PLACEHOLDER}" maxlength="40" autocomplete="off"
             enterkeyhint="done" value="${escapeHtml(item.name)}">
      <input type="text" data-role="price" class="price" inputmode="numeric" placeholder="0" autocomplete="off"
             value="${item.amount ? formatWon(item.amount) : ''}"${item.charged_buy_id ? ' readonly' : ''}>
    </div>`;
}

function renderHows() {
  el.hows.innerHTML = pantryHows()
    .map(
      (c) => `<button type="button" class="chip ${c.id === state.howId ? 'selected' : ''}" data-id="${c.id}">${escapeHtml(c.name)}</button>`,
    )
    .join('');
}

function onHowClick(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.howId = Number(chip.dataset.id);
  renderHows();
  updateSaveState();
}

const readRows = () => [...el.rows.querySelectorAll('.row')].map(readFreeRow).map((l) => ({ ...l, name: l.name.trim() }));

function recalcTotal() {
  const total = readRows().reduce((a, l) => a + l.amount, 0);
  el.total.textContent = total ? formatWon(total) : '';
}

function updateSaveState() {
  el.save.disabled = !(state.howId && readRows().some((l) => l.name));
}

function onRowsInput(e) {
  growItemRows(e.target, PLACEHOLDER);
  recalcTotal();
  updateSaveState();
}

function onRowsClick(e) {
  if (!e.target.closest('[data-act="del-item"]')) return;
  e.target.closest('.row').remove();
  recalcTotal();
  updateSaveState();
}

async function save() {
  const rows = readRows().filter((l) => l.name);
  if (!rows.length || !state.howId) return;
  const item = state.editing;

  el.save.disabled = true;
  try {
    if (item) {
      const patch = { how_id: state.howId, name: rows[0].name, bought_on: el.date.value };
      if (!item.charged_buy_id) patch.amount = rows[0].amount;
      unwrap(await sb.from('pantry_items').update(patch).eq('id', item.id));
    } else {
      unwrap(
        await sb.from('pantry_items').insert(
          rows.map((l) => ({
            how_id: state.howId,
            name: l.name,
            amount: l.amount,
            bought_on: el.date.value,
            created_by: state.userId,
          })),
        ),
      );
    }
    haptic();
    closeSheet(el.sheet);
    await refresh();
  } catch (err) {
    console.error(err);
    toast(needsSql(err) ? 'SQL 의 31번 섹션을 먼저 실행해 주세요' : '저장에 실패했어요. 다시 시도해 주세요');
  } finally {
    el.save.disabled = false;
  }
}

// 목록에서만 뺀다. 이미 가계부에 들어간 돈은 그 끼니의 품목 줄에 있으므로 그대로 남는다.
async function remove() {
  const item = state.editing;
  if (!item) return;
  const msg = item.charged_buy_id
    ? '이 품목은 이미 가계부에 들어갔어요. 목록에서 빼도 가계부 금액은 그대로예요. 뺄까요?'
    : '이 품목을 뺄까요?';
  if (!confirmDialog(msg)) return;
  try {
    unwrap(await sb.from('pantry_items').delete().eq('id', item.id));
    closeSheet(el.sheet);
    await refresh();
  } catch (err) {
    console.error(err);
    toast('삭제에 실패했어요. 다시 시도해 주세요');
  }
}
