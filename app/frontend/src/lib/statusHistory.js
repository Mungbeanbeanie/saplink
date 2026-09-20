import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';

// Polls the real backend's GET /api/status_history (hour-bucketed batch/event
// counts for one device) that drives the dashboard's "Status over time" strip.
// Same polling pattern as network.js/useHealth.js.
export function useStatusHistory(device, hours = 48, intervalMs = 60000) {
  const [hoursData, setHoursData] = useState([]);
  useEffect(() => {
    if (!device) return undefined;
    let live = true;
    const poll = () => apiFetch('/api/status_history?device=' + encodeURIComponent(device) + '&hours=' + hours)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (live) setHoursData(d.hours || []); }, () => {});
    poll();
    const t = setInterval(poll, intervalMs);
    return () => { live = false; clearInterval(t); };
  }, [device, hours, intervalMs]);
  return hoursData;
}
