// 카테고리 데이터 접근 + 설정 화면의 카테고리 관리 렌더.
import { sb } from './supabase.js';
import { escapeHtml, confirmDialog } from './ui.js';
import { howPlaces } from './calc.js';

export async function fetchCategories() {
  const { data, error } = await sb
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return data;
}

// 같은 kind 안에서 맨 뒤에 붙인다. 만들어진 행을 돌려준다.
// extra 는 함께 넣을 열 (예: 식비 '어떻게' 의 where_ids).
export async function addCategory(name, kind, list, extra = {}) {
  const clean = name.trim();
  if (!clean) return null;
  // 같은 이름이 이미 있으면 새로 만들지 않고 그걸 돌려준다. 데이터베이스도 같은
  // 칸에 같은 이름을 막고 있어서, 그냥 넣으면 오류만 나고 사용자는 영문을 모른다.
  const same = list.find((c) => c.kind === kind && c.name === clean);
  if (same) return same;
  const maxOrder = list
    .filter((c) => c.kind === kind)
    .reduce((m, c) => Math.max(m, c.sort_order), 0);
  const { data, error } = await sb
    .from('categories')
    .insert({ name: clean, kind, sort_order: maxOrder + 10, ...extra })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function renameCategory(id, name) {
  const clean = name.trim();
  if (!clean) return;
  const { error } = await sb.from('categories').update({ name: clean }).eq('id', id);
  if (error) throw error;
}

// 식비 '어떻게' 가 나올 '어디서' 들. 비우면 어디서든 나온다.
export async function setCategoryPlaces(id, whereIds) {
  const { error } = await sb.from('categories').update({ where_ids: whereIds }).eq('id', id);
  if (error) throw error;
}

export async function deleteCategory(id) {
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) throw error;
}

// dir = -1(위) / +1(아래). 같은 kind 목록 안에서 자리를 바꾸고, 바뀐 행만 update 한다.
// within 을 주면 그 조건에 맞는 것들 사이에서만 한 칸 움직인다 (어디서별로 나눠 볼 때).
export async function moveCategory(list, id, dir, within = () => true) {
  const target = list.find((c) => c.id === id);
  if (!target) return;
  const same = list.filter((c) => c.kind === target.kind);
  const idx = same.findIndex((c) => c.id === id);
  let j = idx + dir;
  while (j >= 0 && j < same.length && !within(same[j])) j += dir;
  if (j < 0 || j >= same.length) return;
  [same[idx], same[j]] = [same[j], same[idx]];
  const updates = same
    .map((c, i) => ({ id: c.id, sort_order: (i + 1) * 10, prev: c.sort_order }))
    .filter((u) => u.sort_order !== u.prev);
  for (const u of updates) {
    const { error } = await sb.from('categories').update({ sort_order: u.sort_order }).eq('id', u.id);
    if (error) throw error;
  }
}

const KIND_LABEL = { expense: '지출', income: '수입', fixed: '고정비', meal_where: '식비 · 어디서', meal_how: '식비 · 어떻게', trip: '여행 일정', rule: '규칙' };
// 칩에 올릴 짧은 이름. 일곱 개가 한 줄 반에 들어가야 한다.
const KIND_CHIP = { expense: '지출', income: '수입', fixed: '고정비', meal_where: '어디서', meal_how: '어떻게', trip: '여행', rule: '규칙' };
const KINDS = Object.keys(KIND_LABEL);

// 다시 그려도(추가·고치기 뒤에 목록을 새로 받아 온다) 보던 종류와 고치던 줄을 잃지 않게 여기 둔다.
let kindNow = 'expense';
let editingId = null;
let editingSec = '';       // 고치던 줄이 있던 칸 (어떻게는 같은 줄이 여러 칸에 나온다)
let editingPlaces = null;  // 고치는 중인 '어떻게' 가 나올 어디서 id 들

// 한 종류를 몇 칸으로 나눠 보여 준다. 식비 '어떻게' 만 '어디서' 마다 나누고 나머지는 한 칸.
// sec: 칸 이름표(data-sec), placeId: 그 칸의 어디서 id (없으면 null).
function sectionsOf(list, kind) {
  const items = list.filter((c) => c.kind === kind);
  if (kind !== 'meal_how') return [{ sec: 'all', title: KIND_LABEL[kind], placeId: null, items, canAdd: true }];
  const wheres = list.filter((c) => c.kind === 'meal_where');
  const placeIds = wheres.map((w) => w.id);
  const secs = wheres.map((w) => ({
    sec: String(w.id),
    title: `${w.name}에서`,
    placeId: w.id,
    items: items.filter((c) => howPlaces(c, placeIds).includes(w.id)),
    canAdd: true,
  }));
  const anywhere = items.filter((c) => !howPlaces(c, placeIds).length);
  if (anywhere.length || !secs.length) {
    secs.push({ sec: 'any', title: '어디서든 (아직 안 나눈 것)', placeId: null, items: anywhere, canAdd: !secs.length });
  }
  return secs;
}

// container 안에 종류 칩 한 줄과, 고른 종류의 목록·추가 칸만 그린다.
// 예전에는 일곱 종류를 한 화면에 다 펼쳐서 설정이 끝없이 길었다.
// 변경이 성공하면 onChanged() 를 부른다.
export function renderCategoryManager(container, list, { onChanged, onError }) {
  const kind = kindNow;
  const wheres = list.filter((c) => c.kind === 'meal_where');
  const rowHtml = (c, sec) =>
      c.id === editingId && sec === editingSec
        ? `
        <div class="cat-item editing" data-id="${c.id}" data-sec="${sec}">
          <input type="text" class="grow" value="${escapeHtml(c.name)}" maxlength="20" data-role="rename" aria-label="카테고리 이름">
          <button type="button" class="btn small primary" data-act="save">저장</button>
          <button type="button" class="btn small" data-act="cancel">취소</button>
        </div>
        ${kind === 'meal_how' && wheres.length
          ? `<div class="chips cat-places" data-id="${c.id}">
          <span class="hint">어디서 나올까요?</span>
          ${wheres.map((w) => `<button type="button" class="chip mini${editingPlaces?.includes(w.id) ? ' selected' : ''}" data-act="toggle-place" data-place="${w.id}">${escapeHtml(w.name)}</button>`).join('')}
        </div>`
          : ''}`
        : `
        <div class="cat-item" data-id="${c.id}" data-sec="${sec}">
          <span class="name" data-act="edit">${escapeHtml(c.name)}</span>
          <button type="button" class="icon-btn" data-act="edit" aria-label="이름 고치기">✎</button>
          <button type="button" class="icon-btn" data-act="up" aria-label="위로">▲</button>
          <button type="button" class="icon-btn" data-act="down" aria-label="아래로">▼</button>
          <button type="button" class="icon-btn del" data-act="del" aria-label="삭제">✕</button>
        </div>`;
  const sections = sectionsOf(list, kind);
  container.innerHTML = `
    <div class="chips cat-kinds">
      ${KINDS.map((k) => `<button type="button" class="chip${k === kind ? ' selected' : ''}" data-kind-pick="${k}">${KIND_CHIP[k]}</button>`).join('')}
    </div>
    ${sections.map((g) => `
    <div class="cat-group" data-sec="${g.sec}">
      <h3>${escapeHtml(g.title)}</h3>
      ${g.items.map((c) => rowHtml(c, g.sec)).join('') || '<p class="hint">없음</p>'}
      ${g.canAdd
        ? `<form class="row" data-role="add" data-sec="${g.sec}" style="margin-top:8px">
        <input type="text" placeholder="${g.placeId ? `새 어떻게 (${escapeHtml(g.title)})` : `새 ${KIND_LABEL[kind]} 카테고리`}" maxlength="20" data-new="${kind}">
        <button type="submit" class="btn small">추가</button>
      </form>`
        : ''}
    </div>`).join('')}`;
  const secOf = (name) => sections.find((g) => g.sec === name);
  const placeIds = wheres.map((w) => w.id);
  const stopEditing = () => { editingId = null; editingSec = ''; editingPlaces = null; };

  const renameInput = container.querySelector('[data-role="rename"]');
  if (renameInput) {
    renameInput.focus();
    renameInput.select();
  }

  const saveRename = async () => {
    const cat = list.find((c) => c.id === editingId);
    const name = renameInput?.value.trim() ?? '';
    const before = cat ? howPlaces(cat, placeIds) : [];
    const placesChanged = cat?.kind === 'meal_how' && editingPlaces
      && (editingPlaces.length !== before.length || editingPlaces.some((id) => !before.includes(id)));
    if (!cat || !name || (name === cat.name && !placesChanged)) {
      stopEditing();
      renderCategoryManager(container, list, { onChanged, onError });
      return;
    }
    // 같은 칸에 같은 이름은 데이터베이스가 막는다 — 오류 대신 미리 알려 준다.
    if (list.some((c) => c.kind === cat.kind && c.id !== cat.id && c.name === name)) {
      onError?.(new Error('duplicate'), `이미 "${name}" 이 있어요`);
      return;
    }
    try {
      if (name !== cat.name) await renameCategory(cat.id, name);
      if (placesChanged) await setCategoryPlaces(cat.id, editingPlaces);
      stopEditing();
      await onChanged();
    } catch (err) {
      console.error(err);
      onError?.(err);
    }
  };

  renameInput?.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // 한글 조합 중 엔터는 글자를 끝내는 엔터다
    if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
    if (e.key === 'Escape') { stopEditing(); renderCategoryManager(container, list, { onChanged, onError }); }
  });

  for (const form of container.querySelectorAll('[data-role="add"]')) form.onsubmit = async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const placeId = secOf(e.target.dataset.sec)?.placeId ?? null;
    try {
      const created = await addCategory(input.value, kind, list, placeId ? { where_ids: [placeId] } : {});
      if (!created) return;
      // 다른 어디서에 이미 있는 이름이면 이 칸에도 나오게 붙인다.
      const places = howPlaces(created, placeIds);
      if (placeId && !places.includes(placeId)) await setCategoryPlaces(created.id, [...places, placeId]);
      input.value = '';
      await onChanged();
    } catch (err) {
      console.error(err);
      onError?.(err);
    }
  };

  container.onclick = async (e) => {
    const pick = e.target.closest('[data-kind-pick]');
    if (pick) {
      if (pick.dataset.kindPick === kindNow) return;
      kindNow = pick.dataset.kindPick;
      stopEditing();
      renderCategoryManager(container, list, { onChanged, onError });
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const item = btn.closest('.cat-item');
    const id = item ? Number(item.dataset.id) : null;
    const cat = id !== null ? list.find((c) => c.id === id) : null;
    const sec = secOf(item?.dataset.sec);
    if (act === 'edit') {
      editingId = id;
      editingSec = item.dataset.sec;
      editingPlaces = howPlaces(cat, placeIds);
      renderCategoryManager(container, list, { onChanged, onError });
      return;
    }
    if (act === 'toggle-place') {
      // 고치던 이름은 다시 그려도 남게 들고 간다.
      const typed = renameInput?.value;
      const pid = Number(btn.dataset.place);
      editingPlaces = editingPlaces.includes(pid) ? editingPlaces.filter((x) => x !== pid) : [...editingPlaces, pid];
      renderCategoryManager(container, list, { onChanged, onError });
      const again = container.querySelector('[data-role="rename"]');
      if (again && typed != null) again.value = typed;
      return;
    }
    if (act === 'cancel') {
      stopEditing();
      renderCategoryManager(container, list, { onChanged, onError });
      return;
    }
    if (act === 'save') { await saveRename(); return; }
    try {
      // 어디서별로 나눠 볼 때는 그 칸 안에서만 움직인다.
      const inSec = sec && sec.sec !== 'all' ? (c) => sec.items.includes(c) : undefined;
      const places = cat ? howPlaces(cat, placeIds) : [];
      if (act === 'up' || act === 'down') {
        await moveCategory(list, id, act === 'up' ? -1 : 1, inSec);
      } else if (act === 'del' && sec?.placeId && places.length > 1) {
        // 다른 어디서에도 나오는 것은 이 칸에서만 뺀다.
        if (!confirmDialog(`"${cat.name}" 을 ${sec.title} 목록에서 뺄까요?\n다른 곳 목록에는 그대로 남아요.`)) return;
        await setCategoryPlaces(id, places.filter((x) => x !== sec.placeId));
      } else if (act === 'del') {
        if (!confirmDialog(`"${cat.name}" 카테고리를 삭제할까요?\n이 카테고리의 기록은 미분류로 남아요.`)) return;
        await deleteCategory(id);
      } else {
        return;
      }
      await onChanged();
    } catch (err) {
      console.error(err);
      onError?.(err);
    }
  };
}
