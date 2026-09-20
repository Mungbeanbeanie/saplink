import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';

// Polls the real backend's Phase 8 endpoint (app/backend/news.py) -- no dev
// simulator fake for this one, it's read-only and public either way.
export function useNews(limit = 10) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let live = true;
    apiFetch('/api/news?limit=' + limit)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (live) setItems(d.items || []); }, () => {});
    return () => { live = false; };
  }, [limit]);
  return items;
}
