import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import { readCache, writeCache } from './sessionCache.js';

export function useHealth(intervalMs = 15000) {
  const [health, setHealth] = useState(() => readCache('saplink.cache.health', null));
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    const poll = () => apiFetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((h) => { if (live) { setHealth(h); setError(false); writeCache('saplink.cache.health', h); } },
            () => { if (live) setError(true); });
    poll();
    const t = setInterval(poll, intervalMs);
    return () => { live = false; clearInterval(t); };
  }, [intervalMs]);
  return { health, error };
}
