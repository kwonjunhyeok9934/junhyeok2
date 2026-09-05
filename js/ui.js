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

// 짧은 진동(안드로이드). 지원 안 하면 조용히 넘어간다.
export function haptic(ms = 10) {
  try { navigator.vibrate?.(ms); } catch { /* 무시 */ }
}

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// 숫자를 이전 값에서 새 값으로 굴려 보여준다. 첫 표시는 즉시.
export function animateNumber(el, to, format) {
  const from = Number(el.dataset.value ?? NaN);
  el.dataset.value = to;
  if (Number.isNaN(from) || from === to || reduceMotion) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const dur = 450;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
