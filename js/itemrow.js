// 품목 줄 편집기: [이름][가격] 줄이 이어지고, 마지막 빈 줄에 뭔가 적히면 그 아래 빈 줄이 하나 더 붙는다.
// 식비의 '어떻게' 세트와 사 둔 것 담기 시트가 같이 쓴다. 줄을 담는 상자는 둘 다 .set-items 다.
import { escapeHtml } from './ui.js';
import { formatWon, parseWon } from './calc.js';

export const ITEM_PLACEHOLDER = '품목 (선택)';

// fixed = 배달료처럼 이름이 고정된 줄. 이름 칸은 읽기 전용이고 지울 수 없다.
// stacked = 이름을 한 줄 통째로 쓰고 가격을 그 아래로 (긴 품목 이름을 끝까지 보여 줘야 할 때).
export function itemRowHtml(line, { last = false, fixed = false, stacked = false, placeholder = ITEM_PLACEHOLDER } = {}) {
  return `
    <div class="row${stacked ? ' stacked' : ''}">
      <input type="text" data-role="name" placeholder="${escapeHtml(placeholder)}" maxlength="40" autocomplete="off"
             enterkeyhint="next" value="${escapeHtml(line.name ?? '')}"${fixed ? ' readonly' : ''}>
      <input type="text" data-role="price" class="price" inputmode="numeric" placeholder="0" autocomplete="off"
             enterkeyhint="next" value="${line.amount ? formatWon(line.amount) : ''}">
      <button type="button" class="icon-btn" data-act="del-item" aria-label="이 품목 지우기"${last || fixed ? ' style="visibility:hidden"' : ''}>✕</button>
    </div>`;
}

// 직접 적는 줄만 '빈 줄'이 될 수 있다. 배달료(읽기 전용)도, 사 둔 것 줄(칸이 아예 없다)도 아니다.
export const isFreeRow = (row) => !!row.querySelector('[data-role="name"]:not([readonly])');

export const readFreeRow = (row) => ({
  name: row.querySelector('[data-role="name"]').value,
  amount: parseWon(row.querySelector('[data-role="price"]').value),
});

// 가격을 숫자로 다듬고, 마지막 빈 줄에 뭔가 적히면 그 아래 빈 줄을 하나 더 붙인다.
// 타이핑 중에는 다시 그리지 않는다 — 포커스와 캐럿을 지키려고 DOM 을 직접 손본다.
export function growItemRows(input, placeholder) {
  if (input.dataset.role === 'price') {
    const n = parseWon(input.value);
    input.value = n ? formatWon(n) : '';
  }
  const box = input.closest('.set-items');
  const lastFree = [...(box?.children ?? [])].filter(isFreeRow).at(-1);
  if (box && input.closest('.row') === lastFree && (input.value.trim() || parseWon(input.value))) {
    const stacked = lastFree.classList.contains('stacked');
    lastFree.insertAdjacentHTML('afterend', itemRowHtml({ name: '', amount: 0 }, { last: true, stacked, placeholder }));
    lastFree.querySelector('[data-act="del-item"]').style.visibility = '';
  }
}

// 폼 안의 Enter 는 암시적 제출이라 그냥 두면 저장이 눌린다. 다음 칸으로 넘긴다.
// 다음 줄이 사 둔 것 줄이면 옮겨 갈 칸이 없다 — 그냥 제자리에 둔다.
export function onItemRowsKeydown(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const row = e.target.closest('.row');
  if (!row) return;
  if (e.target.dataset.role === 'name') {
    row.querySelector('[data-role="price"]').focus();
    return;
  }
  row.nextElementSibling?.querySelector('[data-role="name"]')?.focus();
}
