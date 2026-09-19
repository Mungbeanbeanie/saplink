import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';

export function useHealth(intervalMs = 15000) {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    const poll = () => apiFetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((h) => { if (live) { setHealth(h); setError(false); } },
            () => { if (live) setError(true); });
    poll();
    const t = setInterval(poll, intervalMs);
    return () => { live = false; clearInterval(t); };
  }, [intervalMs]);
  return { health, error };
}
