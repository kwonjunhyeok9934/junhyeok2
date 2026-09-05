// 웹 푸시 구독: 이 폰에서 알림을 받을지 켜고 끈다. 구독 정보는 push_subscriptions 표에 저장.
import { sb } from './supabase.js';
import { VAPID_PUBLIC_KEY } from './config.js';

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// 'unsupported' | 'denied' | 'on' | 'off'
export async function getState() {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function enable(userId) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('permission');
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));
  const json = sub.toJSON();
  const { error } = await sb
    .from('push_subscriptions')
    .upsert({ user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function disable() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

// 서버 없이 이 폰에서 바로 알림 하나 띄워 본다 (권한·표시 확인용).
export async function testLocal() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('우리집', { body: '알림이 잘 와요 👋', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
}
