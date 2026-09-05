// 우리집 알림 발송 함수.
// 1) Database Webhook (transactions / todos / events INSERT) → 기록한 사람 말고 상대에게 푸시
// 2) 매일 아침 예약 호출 { "kind": "daily" } → 오늘 일정·마감 할일 요약을 모두에게 푸시
//
// 필요한 Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT(mailto:...), WEBHOOK_SECRET
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동으로 넣어 준다.

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const won = (n: number) => n.toLocaleString('en-US');
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function nameOf(userId: string | null) {
  if (!userId) return '누군가';
  const { data } = await sb.from('profiles').select('name').eq('id', userId).maybeSingle();
  return data?.name ?? '누군가';
}

// 웹훅 페이로드 → { title, body, url, exclude }
async function messageForInsert(table: string, r: Record<string, any>) {
  const who = await nameOf(r.created_by);
  if (table === 'transactions') {
    let cat = '미분류';
    if (r.category_id) {
      const { data } = await sb.from('categories').select('name').eq('id', r.category_id).maybeSingle();
      cat = data?.name ?? cat;
    }
    const sign = r.kind === 'income' ? '+' : '';
    return { title: `${who}님이 가계부에 기록했어요`, body: `${cat} ${sign}${won(r.amount)}원${r.memo ? ` · ${r.memo}` : ''}`, url: './#ledger', exclude: r.created_by };
  }
  if (table === 'todos') {
    return { title: `${who}님이 할일을 추가했어요`, body: r.title, url: './#todo', exclude: r.created_by };
  }
  if (table === 'events') {
    const [, m, d] = r.date.split('-').map(Number);
    const time = r.time ? ` ${String(r.time).slice(0, 5)}` : '';
    return { title: `${who}님이 일정을 추가했어요`, body: `${m}/${d}${time} ${r.title}`, url: './#schedule', exclude: r.created_by };
  }
  return null;
}

async function messageForDaily() {
  const today = kstToday();
  const [{ data: events }, { data: todos }] = await Promise.all([
    sb.from('events').select('title,time').eq('date', today).order('time', { ascending: true, nullsFirst: true }),
    sb.from('todos').select('title,due').eq('done', false).lte('due', today),
  ]);
  const ev = events ?? [];
  const td = todos ?? [];
  if (!ev.length && !td.length) return null; // 조용한 날은 보내지 않는다
  const parts: string[] = [];
  if (ev.length) parts.push(`일정 ${ev.length}개: ${ev.slice(0, 2).map((e) => e.title).join(', ')}${ev.length > 2 ? ' 외' : ''}`);
  if (td.length) parts.push(`마감 할일 ${td.length}개: ${td.slice(0, 2).map((t) => t.title).join(', ')}${td.length > 2 ? ' 외' : ''}`);
  return { title: '오늘의 우리집', body: parts.join(' · '), url: './#home', exclude: null, tag: 'daily' };
}

async function send(msg: { title: string; body: string; url: string; exclude: string | null; tag?: string }) {
  let q = sb.from('push_subscriptions').select('*');
  if (msg.exclude) q = q.neq('user_id', msg.exclude);
  const { data: subs } = await q;
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag ?? 'couple' });
  let sent = 0;
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (e: any) {
        // 만료된 구독은 지운다
        if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from('push_subscriptions').delete().eq('id', s.id);
        else console.error('push failed', e?.statusCode, e?.body);
      }
    }),
  );
  return sent;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  let msg = null;
  if (body.kind === 'daily') msg = await messageForDaily();
  else if (body.type === 'INSERT' && body.record) msg = await messageForInsert(body.table, body.record);
  if (!msg) return Response.json({ sent: 0, skipped: true });
  const sent = await send(msg);
  return Response.json({ sent });
});
