// Погода через Open-Meteo (бесплатно, без ключа, CORS ок). Координаты — из
// геолокации устройства, при отказе/недоступности — Москва. Кэш 30 мин в
// localStorage, чтобы не дёргать сеть и не переспрашивать координаты.

const MOSCOW = { lat: 55.75, lon: 37.62 };
const CACHE_KEY = 'life-hub-weather';
const TTL_MS = 30 * 60 * 1000;

export interface Weather {
  tempC: number;
  feelsC: number;
  maxC: number;
  minC: number;
  code: number; // WMO weather code
  isDay: boolean;
  fetchedAt: number;
}

function getCoords(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(MOSCOW);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(MOSCOW), // отказ/ошибка — Москва
      { timeout: 6000, maximumAge: TTL_MS },
    );
  });
}

function readCache(): Weather | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Weather) : null;
  } catch {
    return null; // приватный режим / битый кэш
  }
}

/** Текущая погода (с кэшем). null — сеть/данные недоступны.
 *  Если сеть пропала, а кэш устарел — возвращаем устаревший кэш:
 *  вчерашняя температура полезнее внезапно исчезнувшего виджета. */
export async function getWeather(): Promise<Weather | null> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  try {
    const { lat, lon } = await getCoords();
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,is_day,apparent_temperature` +
      `&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
    // Таймаут: без него на «мёртвой» сети запрос висит бесконечно, а виджет
    // остаётся серым скелетоном навсегда. 7 с — и отдаём кэш (или прячемся).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    let r: Response;
    try {
      r = await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) return cached;
    const d = await r.json();
    const w: Weather = {
      tempC: Math.round(d.current.temperature_2m),
      feelsC: Math.round(d.current.apparent_temperature),
      maxC: Math.round(d.daily.temperature_2m_max[0]),
      minC: Math.round(d.daily.temperature_2m_min[0]),
      code: d.current.weather_code,
      isDay: d.current.is_day === 1,
      fetchedAt: Date.now(),
    };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(w));
    } catch {
      /* приватный режим */
    }
    return w;
  } catch {
    return cached;
  }
}

/** Краткое описание погоды по WMO-коду (для подписи). */
export function weatherLabel(code: number): string {
  if (code === 0) return 'Ясно';
  if (code <= 2) return 'Малооблачно';
  if (code === 3) return 'Облачно';
  if (code <= 48) return 'Туман';
  if (code <= 57) return 'Морось';
  if (code <= 67) return 'Дождь';
  if (code <= 77) return 'Снег';
  if (code <= 82) return 'Ливень';
  if (code <= 86) return 'Снегопад';
  return 'Гроза';
}
