import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';

// Polls the real backend's GET /api/network (density score + per-device
// activity) that drives the dashboard's site-map graph. Same polling pattern
// as useHealth.js.
export function useNetwork(intervalMs = 10000) {
  const [density, setDensity] = useState(0);
  const [nodes, setNodes] = useState([]);
  useEffect(() => {
    let live = true;
    const poll = () => apiFetch('/api/network')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (live) { setDensity(d.density || 0); setNodes(d.nodes || []); } }, () => {});
    poll();
    const t = setInterval(poll, intervalMs);
    return () => { live = false; clearInterval(t); };
  }, [intervalMs]);
  return { density, nodes };
}
