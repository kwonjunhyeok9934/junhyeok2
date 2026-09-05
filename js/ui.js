// 화면 어디에도 속하지 않는 공용 조각.

export const $ = (sel, root = document) => root.querySelector(sel);

export function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function openSheet(el) {
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}

export function closeSheet(el) {
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
}

// 배경(.sheet-backdrop) 클릭으로 닫히게 한 번만 연결한다.
export function bindSheetBackdrop(el) {
  const backdrop = $('.sheet-backdrop', el);
  if (backdrop) backdrop.addEventListener('click', () => closeSheet(el));
}

let toastTimer = null;
export function toast(msg, ms = 2500) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function confirmDialog(msg) {
  return window.confirm(msg);
}
