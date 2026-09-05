// 오늘 날씨 + 미세먼지. 위치는 이 폰에만 저장한다(서버 X). Open-Meteo 무료 API, 키 없음.
const GEO_KEY = 'geo';
const CACHE_KEY = 'weather.cache';
const CACHE_MS = 30 * 60 * 1000;

const WMO = {
  0: ['맑음', '☀️'], 1: ['대체로 맑음', '🌤️'], 2: ['구름 조금', '⛅'], 3: ['흐림', '☁️'],
  45: ['안개', '🌫️'], 48: ['안개', '🌫️'],
  51: ['약한 이슬비', '🌦️'], 53: ['이슬비', '🌦️'], 55: ['이슬비', '🌧️'],
  61: ['약한 비', '🌧️'], 63: ['비', '🌧️'], 65: ['강한 비', '🌧️'], 66: ['진눈깨비', '🌨️'], 67: ['진눈깨비', '🌨️'],
  71: ['약한 눈', '🌨️'], 73: ['눈', '❄️'], 75: ['강한 눈', '❄️'], 77: ['눈', '❄️'],
  80: ['소나기', '🌦️'], 81: ['소나기', '🌧️'], 82: ['강한 소나기', '⛈️'],
  85: ['눈', '🌨️'], 86: ['눈', '❄️'], 95: ['뇌우', '⛈️'], 96: ['뇌우', '⛈️'], 99: ['뇌우', '⛈️'],
};

// 한국 환경부 기준
export function pm10Grade(v) { return v <= 30 ? '좋음' : v <= 80 ? '보통' : v <= 150 ? '나쁨' : '매우나쁨'; }
export function pm25Grade(v) { return v <= 15 ? '좋음' : v <= 35 ? '보통' : v <= 75 ? '나쁨' : '매우나쁨'; }

function savedGeo() {
  try { return JSON.parse(localStorage.getItem(GEO_KEY) || 'null'); } catch { return null; }
}

export function hasLocation() {
  return Boolean(savedGeo());
}

// 폰에 위치 권한을 묻고 저장한다. 거부하면 throw.
export function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const geo = { lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) };
        try { localStorage.setItem(GEO_KEY, JSON.stringify(geo)); localStorage.removeItem(CACHE_KEY); } catch { /* 무시 */ }
        resolve(geo);
      },
      (err) => reject(err),
      { timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// { temp, text, emoji, tmax, tmin, pop, pm10, pm25, place } 또는 위치 없으면 null
export async function getWeather() {
  const geo = savedGeo();
  if (!geo) return null;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && Date.now() - c.at < CACHE_MS && c.lat === geo.lat && c.lon === geo.lon) return c.data;
  } catch { /* 무시 */ }

  const q = `latitude=${geo.lat}&longitude=${geo.lon}&timezone=Asia%2FSeoul`;
  const [w, a, place] = await Promise.all([
    json(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1`),
    json(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=pm10,pm2_5`).catch(() => null),
    json(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${geo.lat}&longitude=${geo.lon}&localityLanguage=ko`).catch(() => null),
  ]);
  const [text, emoji] = WMO[w.current.weather_code] ?? ['흐림', '☁️'];
  const data = {
    temp: Math.round(w.current.temperature_2m),
    text, emoji,
    tmax: Math.round(w.daily.temperature_2m_max[0]),
    tmin: Math.round(w.daily.temperature_2m_min[0]),
    pop: w.daily.precipitation_probability_max?.[0] ?? null,
    pm10: a ? Math.round(a.current.pm10) : null,
    pm25: a ? Math.round(a.current.pm2_5) : null,
    place: place ? [place.city || place.locality, place.principalSubdivision].filter(Boolean).slice(0, 1).join('') || place.locality : '',
  };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), lat: geo.lat, lon: geo.lon, data })); } catch { /* 무시 */ }
  return data;
}
