import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';

// Polls the real backend's GET /api/weather (Blacksburg's current outdoor
// temperature via Open-Meteo -- no per-router location yet, see weather.py).
// Same polling pattern as network.js/statusHistory.js.
export function useWeather(intervalMs = 60000) {
  const [weather, setWeather] = useState({ location: null, temperature_f: null, ok: false });
  useEffect(() => {
    let live = true;
    const poll = () => apiFetch('/api/weather')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (live) setWeather(d); }, () => {});
    poll();
    const t = setInterval(poll, intervalMs);
    return () => { live = false; clearInterval(t); };
  }, [intervalMs]);
  return weather;
}
