import { useEffect, useState } from 'react';
import {
  Sun,
  Moon,
  CloudSun,
  CloudMoon,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudSnow,
  CloudRainWind,
  CloudLightning,
} from 'lucide-react';
import { getWeather, weatherLabel, type Weather } from '../../../lib/weather';

// Возвращаем готовый JSX-элемент (а не тип компонента) — иначе eslint-правило
// react-hooks/static-components ругается на динамический <Icon/> в рендере.
function weatherIcon(code: number, isDay: boolean) {
  const p = { size: 30, strokeWidth: 1.75 };
  if (code === 0) return isDay ? <Sun {...p} /> : <Moon {...p} />;
  if (code <= 2) return isDay ? <CloudSun {...p} /> : <CloudMoon {...p} />;
  if (code === 3) return <Cloud {...p} />;
  if (code <= 48) return <CloudFog {...p} />;
  if (code <= 57) return <CloudDrizzle {...p} />;
  if (code <= 67) return <CloudRain {...p} />;
  if (code <= 77) return <CloudSnow {...p} />;
  if (code <= 82) return <CloudRainWind {...p} />;
  if (code <= 86) return <CloudSnow {...p} />;
  return <CloudLightning {...p} />;
}

/** Виджет текущей погоды на «Сегодня». Прячется, если данные недоступны. */
export function WeatherWidget() {
  const [w, setW] = useState<Weather | null | 'loading'>('loading');

  useEffect(() => {
    let live = true;
    void getWeather().then((res) => {
      if (live) setW(res);
    });
    return () => {
      live = false;
    };
  }, []);

  if (w === 'loading') {
    return <section className="card mb-4 h-[72px] animate-pulse px-4 py-3.5" aria-hidden />;
  }
  if (!w) return null;

  return (
    <section className="card mb-4 flex items-center gap-4 px-4 py-3.5">
      <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
        {weatherIcon(w.code, w.isDay)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold leading-none">{w.tempC}°</span>
          <span className="truncate text-sm font-medium text-muted">{weatherLabel(w.code)}</span>
        </div>
        <p className="mt-1.5 text-xs text-muted">
          Ощущается {w.feelsC}° · день ↑{w.maxC}° ночь ↓{w.minC}°
        </p>
      </div>
    </section>
  );
}
