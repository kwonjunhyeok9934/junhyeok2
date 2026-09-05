// Supabase 연결 정보.
// Supabase 대시보드 → Project Settings → API 에서 복사한다.
//   SUPABASE_URL      : Project URL   (예: https://abcdefgh.supabase.co)
//   SUPABASE_ANON_KEY : anon public 키 (새 형식은 sb_publishable_... 로 시작하는 Publishable key)
// anon 키는 브라우저에 노출되는 것을 전제로 한 공개 키다. service_role 키는 절대 넣지 않는다.
export const SUPABASE_URL = 'https://jfrmpmlbweyecwfwlesh.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_KaifTWAmCOxWs8NhMGx8FA_1vEnqyc_';

// 웹 푸시용 공개 키 (VAPID). 짝이 되는 비밀 키는 Supabase Edge Function 의 Secrets 에만 둔다.
export const VAPID_PUBLIC_KEY = 'BPs7u319qyJSe2SD2YL81CYdMGB-rqfAVM5SD3nUge2eDj9IiIqlo7cRQ--Kb-Vq9bsBhb_x3VkKo5X59sVkceA';
