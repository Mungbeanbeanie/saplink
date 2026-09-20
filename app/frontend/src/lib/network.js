import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import { readCache, writeCache } from './sessionCache.js';

const CACHE_KEY = 'saplink.cache.network';

// Polls the real backend's GET /api/network (density score + per-device
// activity) that drives the dashboard's site-map graph. Same polling pattern
// as useHealth.js.
export function useNetwork(intervalMs = 10000) {
  const cached = readCache(CACHE_KEY, null);
  const [density, setDensity] = useState(cached ? cached.density || 0 : 0);
  const [nodes, setNodes] = useState(cached ? cached.nodes || [] : []);
  useEffect(() => {
    let live = true;
    const poll = () => apiFetch('/api/network')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (live) {
          const density = d.density || 0, nodes = d.nodes || [];
          setDensity(density); setNodes(nodes);
          writeCache(CACHE_KEY, { density, nodes });
        }
      }, () => {});
    poll();
    const t = setInterval(poll, intervalMs);
    return () => { live = false; clearInterval(t); };
  }, [intervalMs]);
  return { density, nodes };
}
