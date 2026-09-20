// 사 둔 것 탭: 윙잇·컬리·쿠팡·마트·편의점에서 산 품목을 미리 담아 둔다.
// 담을 때는 가계부에 안 들어간다 — 식비에서 처음 꺼내 먹을 때 한 번만 값이 실린다(js/meal.js).
// 목록의 원본이 여기라, 식비 탭은 items() 로 가져다 드롭다운을 만든다.
//
// 주문 스크린샷을 고르면 폰 안에서 글자를 읽어(js/ocr.js) 품목·가격 줄을 채워 준다.
// 글자는 조금씩 틀리게 읽히므로 **바로 저장하지 않는다** — 사람이 보고 고친 뒤 저장한다.
import { sb } from './supabase.js';
import { $, escapeHtml, openSheet, closeSheet, bindSheetBackdrop, toast, confirmDialog, haptic, animateNumber } from './ui.js';
import {
  todayLocal, shiftDay, formatWon, howNeedsShop, groupPantryByHow, pantryStats, pantryLeftOf, tagColor,
  parseOrderText, guessOrderHow, guessOrderDate,
} from './calc.js';
import { fetchCategories, addCategory } from './categories.js';
import { itemRowHtml, growItemRows, readFreeRow, onItemRowsKeydown } from './itemrow.js';
import * as ocr from './ocr.js';

const PLACEHOLDER = '품목 (예: 삼겹살)';

const state = {
  items: [],       // 남은 것 전부 + 최근에 다 쓴 것
  cats: [],
  userId: null,
  error: null,     // 사 둔 것 표가 아직 없으면 여기 담긴다
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
    shotRow: $('#pantry-shot-row'), shot: $('#pantry-shot'),
    shotFile: $('#pantry-shot-file'), shotNote: $('#pantry-shot-note'),
    cam: $('#pantry-cam'), camFile: $('#pantry-cam-file'),
    shotRaw: $('#pantry-shot-raw'), shotText: $('#pantry-shot-text'),
    newHowRow: $('#pantry-new-how-row'), newHow: $('#pantry-new-how'),
    newHowOk: $('#pantry-new-how-ok'),
  };

  bindSheetBackdrop(el.sheet);
  el.list.addEventListener('click', onListClick);
  el.doneToggle.addEventListener('click', () => {
    state.showDone = !state.showDone;
    render();
  });
  el.hows.addEventListener('click', onHowClick);
  el.newHowOk.addEventListener('click', createHow);
  el.newHow.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); createHow(); }
  });
  el.rows.addEventListener('input', onRowsInput);
  el.rows.addEventListener('click', onRowsClick);
  el.rows.addEventListener('keydown', onItemRowsKeydown);
  el.form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  el.del.addEventListener('click', remove);
  el.shot.addEventListener('click', () => {
    el.shotFile.value = ''; // 같은 사진을 다시 골라도 change 가 오게
    el.shotFile.click();
  });
  el.cam.addEventListener('click', () => {
    el.camFile.value = '';
    el.camFile.click();
  });
  el.shotFile.addEventListener('change', onShotPick);
  el.camFile.addEventListener('change', onShotPick);
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

// 아직 schema.sql 을 실행하지 않아 표가 없는 상태인지.
function needsSql(err) {
  const m = `${err?.message ?? ''} ${err?.code ?? ''}`;
  return /does not exist|could not find the table|42P01|PGRST205/i.test(m);
}

const sheetOpen = () => el?.sheet.classList.contains('open');

// ---- 조회 ------------------------------------------------------------------

// 실패해도 던지지 않는다 — 사 둔 것 표가 아직 없어도 식비 탭은 멀쩡해야 한다.
export async function load() {
  if (!initialized) return;
  try {
    const [cats, items] = await Promise.all([
      fetchCategories(),
      sb
        .from('pantry_items')
        .select('id,how_id,name,amount,bought_on,charged_buy_id,done,qty,left_qty')
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

// 식비에서 사 둔 것을 꺼내 쓰고 저장하면 load() 로 최신 값을 받아 오지만,
// 목록 화면은 그대로 남아 '다 씀' 으로 바뀌지 않았다. 받아 온 것을 그린다.
export function redraw() {
  if (!initialized || sheetOpen()) return; // 담는 중에는 건드리지 않는다
  render();
}

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
      ? `<p class="empty">사 둔 것 표가 아직 준비되지 않았어요.<br>Supabase SQL Editor 에서<br><code>schema.sql</code> 전체를 한 번 실행해 주세요.</p>`
      : `<div class="retry">불러오지 못했어요<br>
          <button type="button" class="btn small" data-retry>다시 시도</button>
        </div>`;
    return;
  }
  el.notice.hidden = true;
  el.listHead.hidden = false;

  const stats = pantryStats(state.items);
  animateNumber(el.left, stats.units, (n) => `${n}개`);
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
  const qty = Math.max(1, Number(it.qty) || 1);
  const left = pantryLeftOf(it);
  return `
    <div class="tx-row pantry-row${it.done ? ' done' : ''}" data-pantry="${it.id}" style="--i:${Math.min(i, 12)}">
      <span class="tag how" style="${tint(tagColor(how))}">${escapeHtml(mdLabel(it.bought_on))}</span>
      <div class="tx-main">
        <div class="tx-cat">${escapeHtml(it.name)}${qty > 1 ? `<small> ×${qty}</small>` : ''}</div>
        <div class="tx-memo">${it.charged_buy_id ? '가계부에 들어감' : '아직 안 들어감'}${qty > 1 && !it.done ? ` · ${left}개 남음` : ''}</div>
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

// 목록에서 손으로 끝내거나 되돌린다. 끼니에 적어 둔 개수와 상관없이 여기서 정한 값이 된다
// (그 품목을 쓴 끼니를 나중에 고치면 그때 다시 세어진다).
async function toggleDone(item) {
  const done = !item.done;
  const qty = Math.max(1, Number(item.qty) || 1);
  const before = { done: item.done, left_qty: item.left_qty };
  item.done = done;
  item.left_qty = done ? 0 : qty;
  render();
  if (done) haptic(15);
  try {
    unwrap(await sb.from('pantry_items').update({ done, left_qty: item.left_qty }).eq('id', item.id));
  } catch (err) {
    console.error(err);
    Object.assign(item, before);
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
  el.charged.hidden = !priceLocked(item);
  el.shotRow.hidden = !!item || !ocr.supported(); // 한 품목을 고칠 때는 스크린샷 읽기가 필요 없다
  el.shot.disabled = false;
  el.cam.disabled = false;
  el.shotNote.hidden = true;
  el.shotRaw.hidden = true;
  el.newHowRow.hidden = true;
  el.newHow.value = '';
  el.shotRaw.open = false;
  renderHows();
  el.rows.innerHTML = item
    ? editRowHtml(item)
    : itemRowHtml({ name: '', amount: 0 }, { last: true, stacked: true, qty: true, placeholder: PLACEHOLDER });
  recalcTotal();
  updateSaveState();
  openSheet(el.sheet);
  if (!item) setTimeout(() => el.rows.querySelector('[data-role="name"]')?.focus(), 250);
}

// 이미 가계부로 넘어간 품목은 가격 칸이 잠긴다 —
// 그 끼니의 품목 줄이 원본이라 여기서 바꾸면 둘이 어긋난다.
function editRowHtml(item) {
  const qty = Math.max(1, Number(item.qty) || 1);
  return `
    <div class="row stacked">
      <input type="text" data-role="name" placeholder="${PLACEHOLDER}" maxlength="40" autocomplete="off"
             enterkeyhint="done" value="${escapeHtml(item.name)}">
      <input type="text" data-role="qty" class="qty" inputmode="numeric" placeholder="1개" autocomplete="off"
             aria-label="개수" value="${qty > 1 ? `${qty}개` : ''}">
      <input type="text" data-role="price" class="price" inputmode="numeric" placeholder="0" autocomplete="off"
             value="${item.amount ? formatWon(item.amount) : ''}"${item.charged_buy_id ? ' readonly' : ''}>
    </div>`;
}

function renderHows() {
  el.hows.innerHTML = pantryHows()
    .map(
      (c) => `<button type="button" class="chip ${c.id === state.howId ? 'selected' : ''}" data-id="${c.id}">${escapeHtml(c.name)}</button>`,
    )
    .join('') + '<button type="button" class="chip add" data-add>＋</button>';
}

function onHowClick(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  if (chip.dataset.add !== undefined) {
    el.newHowRow.hidden = false;
    el.newHow.focus();
    return;
  }
  state.howId = Number(chip.dataset.id);
  renderHows();
  updateSaveState();
}

async function createHow() {
  const name = el.newHow.value;
  if (!name.trim()) return;
  try {
    const created = await addCategory(name, 'meal_how', state.cats);
    state.cats = await fetchCategories();
    if (!pantryHows().some((c) => c.id === created.id)) {
      toast(`'${created.name}' 은 갈 때마다 가게가 달라서 사 둔 것에 담지 않아요`);
      return;
    }
    state.howId = created.id;
    el.newHow.value = '';
    el.newHowRow.hidden = true;
    renderHows();
    updateSaveState();
  } catch (err) {
    console.error(err);
    toast('산 곳을 추가하지 못했어요');
  }
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

// ---- 주문 스크린샷에서 읽기 -----------------------------------------------------

async function onShotPick(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  el.shot.disabled = true;
  el.cam.disabled = true;
  el.shotNote.hidden = false;
  el.shotNote.textContent = '읽는 중… 처음 한 번은 한글 데이터를 받느라 좀 걸려요';
  const show = (p) => { el.shotNote.textContent = `읽는 중… ${Math.round(p * 100)}%`; };
  try {
    let read = await ocr.readText(file, show, ocr.PSM.COLUMN);
    let found = parseOrderText(read.text);
    // 사진·버튼이 섞인 화면은 훑는 방식에 따라 결과가 확 달라진다. 거의 못 찾았으면 한 번 더.
    if (found.length < 2) {
      el.shotNote.textContent = '다시 한 번 읽는 중…';
      const alt = await ocr.readText(file, show, ocr.PSM.BLOCK);
      const altFound = parseOrderText(alt.text);
      if (altFound.length > found.length) {
        read = alt;
        found = altFound;
      }
    }
    const { text, raw } = read;
    // 읽은 글은 늘 펼쳐 볼 수 있게 둔다 — 엉뚱하게 나왔을 때 무엇을 봤는지 알 수 있어야 한다.
    el.shotRaw.hidden = false;
    el.shotText.textContent = text.trim() || '(글자를 하나도 못 읽었어요)';
    if (!found.length) {
      el.shotNote.textContent = '품목을 못 찾았어요. 아래 \'읽은 글 보기\' 로 뭘 봤는지 확인할 수 있어요.';
      return;
    }
    const how = guessOrderHow(raw, state.cats);
    if (how) {
      state.howId = how;
      renderHows();
    }
    const date = guessOrderDate(raw);
    if (date) el.date.value = date;
    fillRows(found);
    haptic();
    el.shotNote.textContent = `${found.length}개를 읽었어요. 틀린 건 고치고, 필요 없는 줄은 ✕ 로 빼 주세요.`;
  } catch (err) {
    console.error(err);
    el.shotNote.textContent = '스크린샷을 읽지 못했어요. 아래에 직접 적어 주세요.';
  } finally {
    el.shot.disabled = false;
    el.cam.disabled = false;
  }
}

// 읽은 품목을 줄로 깐다. 이미 적어 둔 줄은 그대로 두고 그 뒤에 붙인다.
function fillRows(found) {
  const typed = readRows().filter((l) => l.name || l.amount);
  el.rows.innerHTML =
    [...typed, ...found].map((l) => itemRowHtml(l, { stacked: true, qty: true, placeholder: PLACEHOLDER })).join('') +
    itemRowHtml({ name: '', amount: 0 }, { last: true, stacked: true, qty: true, placeholder: PLACEHOLDER });
  recalcTotal();
  updateSaveState();
}

// 이미 꺼내 쓴 것이 있으면 총액을 못 바꾼다. 쓴 만큼은 벌써 가계부에 들어가 있어서
// 여기서 값을 바꾸면 지난 기록과 어긋난다. (charged_buy_id 는 옛 방식으로 전가를
// 이미 낸 품목 표시다.)
function priceLocked(item) {
  if (!item) return false;
  if (item.charged_buy_id) return true;
  return pantryLeftOf(item) < Math.max(1, Math.trunc(Number(item.qty) || 1));
}

async function save() {
  const rows = readRows().filter((l) => l.name);
  if (!rows.length || !state.howId) return;
  const item = state.editing;

  el.save.disabled = true;
  try {
    if (item) {
      const patch = { how_id: state.howId, name: rows[0].name, bought_on: el.date.value, qty: rows[0].qty };
      // 개수를 줄이면 남은 개수도 그 안으로 (늘리면 늘어난 만큼 더 남는다)
      patch.left_qty = Math.max(0, Math.min(rows[0].qty, pantryLeftOf(item) + (rows[0].qty - Math.max(1, Number(item.qty) || 1))));
      if (!priceLocked(item)) patch.amount = rows[0].amount;
      unwrap(await sb.from('pantry_items').update(patch).eq('id', item.id));
    } else {
      unwrap(
        await sb.from('pantry_items').insert(
          rows.map((l) => ({
            how_id: state.howId,
            name: l.name,
            amount: l.amount,
            qty: l.qty,
            left_qty: l.qty,
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
    toast(needsSql(err) ? 'schema.sql 전체를 한 번 실행해 주세요' : '저장에 실패했어요. 다시 시도해 주세요');
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
