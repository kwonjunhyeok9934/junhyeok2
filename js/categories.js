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

const KIND_LABEL = { expense: '지출', income: '수입' };

// container 안에 지출/수입 두 그룹을 그린다. 변경이 성공하면 onChanged() 를 부른다.
export function renderCategoryManager(container, list, { onChanged, onError }) {
  container.innerHTML = ['expense', 'income']
    .map((kind) => {
      const rows = list
        .filter((c) => c.kind === kind)
        .map(
          (c) => `
        <div class="cat-item" data-id="${c.id}">
          <span class="name" data-act="rename">${escapeHtml(c.name)}</span>
          <button type="button" class="icon-btn" data-act="up" aria-label="위로">▲</button>
          <button type="button" class="icon-btn" data-act="down" aria-label="아래로">▼</button>
          <button type="button" class="icon-btn del" data-act="del" aria-label="삭제">✕</button>
        </div>`,
        )
        .join('');
      return `
      <div class="cat-group">
        <h3>${KIND_LABEL[kind]}</h3>
        ${rows || '<p class="hint">없음</p>'}
        <div class="row" style="margin-top:8px">
          <input type="text" placeholder="새 ${KIND_LABEL[kind]} 카테고리" maxlength="20" data-new="${kind}">
          <button type="button" class="btn small" data-act="add" data-kind="${kind}">추가</button>
        </div>
      </div>`;
    })
    .join('');

  container.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const item = btn.closest('.cat-item');
    const id = item ? Number(item.dataset.id) : null;
    const cat = id !== null ? list.find((c) => c.id === id) : null;
    try {
      if (act === 'add') {
        const input = container.querySelector(`input[data-new="${btn.dataset.kind}"]`);
        const created = await addCategory(input.value, btn.dataset.kind, list);
        if (!created) return;
        input.value = '';
      } else if (act === 'rename') {
        const name = window.prompt('카테고리 이름', cat.name);
        if (name === null || !name.trim() || name.trim() === cat.name) return;
        await renameCategory(id, name);
      } else if (act === 'up' || act === 'down') {
        await moveCategory(list, id, act === 'up' ? -1 : 1);
      } else if (act === 'del') {
        if (!confirmDialog(`"${cat.name}" 카테고리를 삭제할까요?\n이 카테고리의 기록은 미분류로 남아요.`)) return;
        await deleteCategory(id);
      }
      await onChanged();
    } catch (err) {
      console.error(err);
      onError?.(err);
    }
  };
}
