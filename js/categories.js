// 카테고리 데이터 접근 + 설정 화면의 카테고리 관리 렌더.
import { sb } from './supabase.js';
import { escapeHtml, confirmDialog } from './ui.js';

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
export async function addCategory(name, kind, list) {
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
    .insert({ name: clean, kind, sort_order: maxOrder + 10 })
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

export async function deleteCategory(id) {
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) throw error;
}

// dir = -1(위) / +1(아래). 같은 kind 목록 안에서 자리를 바꾸고, 바뀐 행만 update 한다.
export async function moveCategory(list, id, dir) {
  const target = list.find((c) => c.id === id);
  if (!target) return;
  const same = list.filter((c) => c.kind === target.kind);
  const idx = same.findIndex((c) => c.id === id);
  const j = idx + dir;
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

// container 안에 종류 칩 한 줄과, 고른 종류의 목록·추가 칸만 그린다.
// 예전에는 일곱 종류를 한 화면에 다 펼쳐서 설정이 끝없이 길었다.
// 변경이 성공하면 onChanged() 를 부른다.
export function renderCategoryManager(container, list, { onChanged, onError }) {
  const kind = kindNow;
  const rows = list
    .filter((c) => c.kind === kind)
    .map((c) =>
      c.id === editingId
        ? `
        <div class="cat-item editing" data-id="${c.id}">
          <input type="text" class="grow" value="${escapeHtml(c.name)}" maxlength="20" data-role="rename" aria-label="카테고리 이름">
          <button type="button" class="btn small primary" data-act="save">저장</button>
          <button type="button" class="btn small" data-act="cancel">취소</button>
        </div>`
        : `
        <div class="cat-item" data-id="${c.id}">
          <span class="name" data-act="edit">${escapeHtml(c.name)}</span>
          <button type="button" class="icon-btn" data-act="edit" aria-label="이름 고치기">✎</button>
          <button type="button" class="icon-btn" data-act="up" aria-label="위로">▲</button>
          <button type="button" class="icon-btn" data-act="down" aria-label="아래로">▼</button>
          <button type="button" class="icon-btn del" data-act="del" aria-label="삭제">✕</button>
        </div>`,
    )
    .join('');
  container.innerHTML = `
    <div class="chips cat-kinds">
      ${KINDS.map((k) => `<button type="button" class="chip${k === kind ? ' selected' : ''}" data-kind-pick="${k}">${KIND_CHIP[k]}</button>`).join('')}
    </div>
    <div class="cat-group">
      <h3>${KIND_LABEL[kind]}</h3>
      ${rows || '<p class="hint">없음</p>'}
      <form class="row" data-role="add" style="margin-top:8px">
        <input type="text" placeholder="새 ${KIND_LABEL[kind]} 카테고리" maxlength="20" data-new="${kind}">
        <button type="submit" class="btn small">추가</button>
      </form>
    </div>`;

  const renameInput = container.querySelector('[data-role="rename"]');
  if (renameInput) {
    renameInput.focus();
    renameInput.select();
  }

  const saveRename = async () => {
    const cat = list.find((c) => c.id === editingId);
    const name = renameInput?.value.trim() ?? '';
    if (!cat || !name || name === cat.name) {
      editingId = null;
      renderCategoryManager(container, list, { onChanged, onError });
      return;
    }
    // 같은 칸에 같은 이름은 데이터베이스가 막는다 — 오류 대신 미리 알려 준다.
    if (list.some((c) => c.kind === cat.kind && c.id !== cat.id && c.name === name)) {
      onError?.(new Error('duplicate'), `이미 "${name}" 이 있어요`);
      return;
    }
    try {
      await renameCategory(cat.id, name);
      editingId = null;
      await onChanged();
    } catch (err) {
      console.error(err);
      onError?.(err);
    }
  };

  renameInput?.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // 한글 조합 중 엔터는 글자를 끝내는 엔터다
    if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
    if (e.key === 'Escape') { editingId = null; renderCategoryManager(container, list, { onChanged, onError }); }
  });

  container.querySelector('[data-role="add"]').onsubmit = async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    try {
      const created = await addCategory(input.value, kind, list);
      if (!created) return;
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
      editingId = null;
      renderCategoryManager(container, list, { onChanged, onError });
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const item = btn.closest('.cat-item');
    const id = item ? Number(item.dataset.id) : null;
    const cat = id !== null ? list.find((c) => c.id === id) : null;
    if (act === 'edit') {
      editingId = id;
      renderCategoryManager(container, list, { onChanged, onError });
      return;
    }
    if (act === 'cancel') {
      editingId = null;
      renderCategoryManager(container, list, { onChanged, onError });
      return;
    }
    if (act === 'save') { await saveRename(); return; }
    try {
      if (act === 'up' || act === 'down') {
        await moveCategory(list, id, act === 'up' ? -1 : 1);
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
