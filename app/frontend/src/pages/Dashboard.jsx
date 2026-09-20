import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header.jsx';
import GoogleSignInButton from '../components/GoogleSignInButton.jsx';
import Copyright from '../components/Copyright.jsx';
import { css } from '../lib/css.js';
import { useAuth } from '../lib/auth.js';
import { apiFetch } from '../lib/api.js';
import { useNews } from '../lib/news.js';
import { useNetwork } from '../lib/network.js';

// Site-map graph: every node is a real device from /api/network, laid out on
// a fixed schematic grid -- there's no real per-router GPS/site-layout data
// anywhere in this system, so positions are arbitrary spacing, not claimed
// physical placement. No filler/padding nodes anymore: a network with one
// real router just shows one node.
const MAX_NODES = 14;

function seededRng(seed) {
  let x = seed;
  return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
}
// Fixed seed, generated once up to MAX_NODES: slicing keeps each device's
// slot stable as the count of real devices changes between polls, instead of
// the whole layout jumping around.
const SITE_POSITIONS = (() => {
  const rand = seededRng(1337);
  return Array.from({ length: MAX_NODES }, () => ({ x: 40 + rand() * 520, y: 30 + rand() * 240 }));
})();

function buildSiteGraph(realNodes) {
  const nodes = realNodes.slice(0, MAX_NODES).map((n, i) => ({
    ...SITE_POSITIONS[i], id: n.device, activity: n.activity || 0
  }));
  // Nearest-2-neighbor proximity graph -- works for any node count. O(n^2) is
  // fine at this scale (<=14 nodes).
  const links = [];
  const seen = new Set();
  nodes.forEach((n, i) => {
    nodes
      .map((m, j) => ({ j, d: i === j ? Infinity : Math.hypot(n.x - m.x, n.y - m.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .forEach(({ j }) => {
        const key = i < j ? i + '-' + j : j + '-' + i;
        if (!seen.has(key)) { seen.add(key); links.push({ a: i, b: j, activity: (nodes[i].activity + nodes[j].activity) / 2 }); }
      });
  });
  return { nodes, links };
}
// mV that counts as "fully lit" -- a tuned display heuristic, not a
// calibrated threshold; revisit against real VP amplitudes once more devices
// report.
const FULL_GLOW_MV = 5;

const DEFAULT_THRESHOLD_MV = 70; // real backend doesn't expose a threshold yet -- see spike rendering below

const fmtTime = (t) => (t ? new Date(t).toTimeString().slice(0, 8) : '—');
const fmtAgo = (ts) => {
  if (ts == null) return '—';
  const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
};

export default function Dashboard() {
  const { signedIn, token } = useAuth();
  const news = useNews(6);
  const network = useNetwork();
  const graph = useMemo(() => buildSiteGraph(network.nodes), [network.nodes]);
  const [searchParams] = useSearchParams();
  // Arriving from Account's "View" button (?device=sense-2) pre-selects that
  // router's tab. There's no fixed device roster to validate against
  // anymore -- an id that turns out not to be real just won't show up in the
  // tab list once /api/health answers.
  const [device, setDevice] = useState(() => searchParams.get('device') || 'sense-1');
  const [samples, setSamples] = useState([]);
  const [baseline, setBaseline] = useState(42);
  const [src, setSrc] = useState('sim');
  const [live, setLive] = useState(false);
  const [health, setHealth] = useState(null);
  const [healthErr, setHealthErr] = useState(false);
  const [spike, setSpike] = useState(null);
  const [acked, setAcked] = useState(false);
  const [hoverId, setHoverId] = useState(null);
  const [replayNote, setReplayNote] = useState('');
  const [exportNote, setExportNote] = useState('');
  const [soilMv, setSoilMv] = useState(null);
  const lastId = useRef(0);

  // Readings: the API when it answers, a labelled preview feed when it does not.
  useEffect(() => {
    // The wire shape is the real backend's (app/backend/main.py): { last_id,
    // samples: [{ batch_id, device, t_ms, mv, baseline_mv, event, src,
    // soil_mv, seq }] }. t_ms is the router's millis() clock, not a wall-clock
    // timestamp, so it's only used for ordering upstream -- for display we
    // stamp each incoming sample with the time the browser received it.
    const ingest = (d) => {
      const rows = (d && d.samples) || [];
      if (!rows.length) return;
      if (d.last_id != null) lastId.current = d.last_id;
      const last = rows[rows.length - 1];
      const now = Date.now();
      setLive(true);
      setBaseline(last.baseline_mv != null ? last.baseline_mv : 42);
      setSrc(last.src || 'sim');
      if (last.soil_mv != null) setSoilMv(last.soil_mv);
      if (last.event === 'spike') setSpike({ mv: last.mv, threshold: undefined, t: now });
      setSamples((prev) => prev.concat(rows.map((r) => ({ t: now, mv: r.mv, event: r.event, seq: r.seq }))).slice(-180));
    };

    const mock = () => setSamples((prev) => {
      const now = Date.now();
      let s = prev.slice();
      if (!s.length) {
        for (let i = 120; i > 0; i--) s.push({ t: now - i * 1000, mv: 42 + Math.sin(i / 7) * 3.4 + (i % 5) * 0.4, seq: 900 + (120 - i) });
      }
      const i = s.length;
      const spiking = i % 47 === 0;
      const mv = spiking ? 82 + Math.random() * 14 : 42 + Math.sin(i / 7) * 3.4 + (Math.random() - 0.5) * 2.2;
      const seq = (s[s.length - 1].seq || 0) + (Math.random() < 0.04 ? 2 : 1);
      s.push({ t: now, mv, event: spiking ? 'spike' : null, seq });
      if (spiking) setSpike({ mv, threshold: DEFAULT_THRESHOLD_MV, t: now });
      setLive(false);
      return s.slice(-180);
    });

    const tick = () => apiFetch('/api/readings/history?since_id=' + lastId.current)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(ingest, mock);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const poll = () => apiFetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((h) => { setHealth(h); setHealthErr(false); }, () => setHealthErr(true));
    poll();
    const t = setInterval(poll, 10000);
    return () => clearInterval(t);
  }, []);

  const v = useMemo(() => {
    const s = samples;
    const mvs = s.map((x) => x.mv);
    // Never rises above 0 -- the 0 mV line should always be on the chart,
    // not just implied, even though readings themselves stay well clear of it.
    const lo = Math.min(0, mvs.length ? Math.min(Math.min(...mvs), baseline) - 6 : 0);
    const hi = mvs.length ? Math.max(Math.max(...mvs), baseline) + 6 : 100;
    const W = 900, H = 280;
    const X = (i) => (s.length < 2 ? 0 : (i / (s.length - 1)) * W);
    const Y = (val) => H - ((val - lo) / (hi - lo)) * H;
    const pt = (i) => X(i).toFixed(1) + ' ' + Y(s[i].mv).toFixed(1);
    const linePath = s.length ? 'M' + s.map((_, i) => pt(i)).join('L') : '';
    const spikeSeg = [];
    s.forEach((x, i) => { if (x.event === 'spike' && i > 0) spikeSeg.push('M' + pt(i - 1) + 'L' + pt(i)); });

    const seqs = s.map((x) => x.seq).filter((x) => x != null);
    let dropped = 0;
    for (let i = 1; i < seqs.length; i++) { const d = seqs[i] - seqs[i - 1]; if (d > 1) dropped += d - 1; }

    const completeness = seqs.length ? Math.max(0, 100 - (dropped / (seqs.length + dropped)) * 100) : 100;

    // Horizontal gridlines every 10 mV, snapped to the current lo/hi range --
    // recomputed here each time that range changes, so they track live data.
    const GRID_STEP = 10;
    const gridLines = [];
    for (let val = Math.ceil(lo / GRID_STEP) * GRID_STEP; val <= hi; val += GRID_STEP) {
      gridLines.push({ value: val, y: Y(val) });
    }

    return {
      s, lo, hi, H, W, linePath, gridLines,
      areaPath: s.length ? linePath + 'L' + W + ' ' + H + 'L0 ' + H + 'Z' : '',
      spikePath: spikeSeg.join(' '),
      baselineY: Y(baseline).toFixed(1),
      seqs, dropped, completeness,
      current: s.length ? s[s.length - 1].mv : null
    };
  }, [samples, baseline]);

  // Real devices only -- from /api/health, not a fixed fake fleet. Falls
  // back to just the currently-selected id before the first health poll
  // answers, so the tab bar is never empty.
  const devices = health && health.devices && health.devices.length ? health.devices : [device];
  const connected = health && health.devices ? health.devices.length : 0;
  const deviceReporting = !!(health && health.devices && health.devices.includes(device));
  const spikeActive = !!spike && !acked;
  const isSim = src !== 'ads1115';
  const online = !!(health && health.ok);
  const ago = health && health.last_recv ? Math.max(0, Math.round((Date.now() - health.last_recv) / 1000)) + 's ago' : '—';
  const gapBg = v.dropped ? 'var(--color-accent-200)' : 'var(--color-accent-2-200)';
  const gapFg = v.dropped ? 'var(--color-accent-900)' : 'var(--color-accent-2-900)';

  const download = (kind) => {
    const rows = samples;
    if (!rows.length) return;
    const body = kind === 'csv'
      ? 'timestamp_ms,time,device,mv,resting_mv,event\n' + rows.map((r) => [r.t, new Date(r.t).toISOString(), device, r.mv.toFixed(2), baseline, r.event || ''].join(',')).join('\n')
      : JSON.stringify({ device, source: src, resting_mv: baseline, readings: rows }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: kind === 'csv' ? 'text/csv' : 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'saplink-' + device + '.' + kind;
    a.click();
    URL.revokeObjectURL(url);
    setExportNote(rows.length + ' readings saved as ' + kind.toUpperCase() + '.');
  };

  const sendReplay = () => {
    if (!signedIn) return;
    setReplayNote('Sending…');
    // /api/alerts/manual only exists on the local dev simulator (server/index.js).
    // The real backend's alert plane IS built now (POST /api/alerts, GET
    // /api/alerts/pending, POST /api/alerts/{id}/ack -- see app/backend/main.py),
    // but /api/alerts/manual was deliberately dropped: "no browser-reachable
    // write can run the pump" (main.py's module docstring). A 404 against the
    // real API is expected and permanent by design, not a gap to close --
    // falls back to the same "shown as a preview" message either way.
    apiFetch('/api/alerts/manual', {
      method: 'POST',
      headers: token ? { Authorization: 'Bearer ' + token } : undefined
    }).then(
      (r) => (r.ok ? Promise.resolve() : Promise.reject()),
      () => Promise.reject()
    ).then(
      () => { setReplayNote('Test signal sent'); setAcked(true); },
      () => { setReplayNote('Relay not switched on yet — shown as a preview'); setAcked(true); }
    );
  };

  // No backend endpoint returns per-hour history (only current health and raw
  // recent samples) -- "Status over time" below shows that honestly instead
  // of fabricating 48 hours of blocks, same "not live yet" pattern already
  // used for Response relay further down.

  return (
    <div style={css('min-height: 100vh; background: var(--color-bg)')}>
      <Header />
      <main style={css('padding: clamp(20px, 3vw, 40px) clamp(20px, 5vw, 64px) 80px; display: flex; flex-direction: column; gap: 22px')}>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="card-kicker" style={css('margin-bottom: 6px')}>Live monitoring</div>
            <h1 style={css('margin: 0; font-size: clamp(30px, 4vw, 50px); line-height: 1.05')}>What the plant is signalling</h1>
            <p style={css('margin: 10px 0 0; max-width: 60ch; font-size: 15px; line-height: 1.6; color: var(--color-neutral-700)')}>
              Every plant on the network has its own router. Plants change their electrical activity as conditions change — more water, more light, a wound, a dry spell — and when that activity moves clear of the plant’s resting level the router puts it on the network, reaching this page within seconds.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span style={css('font-size: 13px; color: var(--color-neutral-600)')}>Router</span>
            <div className="seg" style={css('border-radius: 999px')}>
              {devices.map((id) => (
                <button
                  key={id}
                  type="button" className="seg-opt"
                  onClick={() => setDevice(id)}
                  style={{ borderRadius: 999, padding: '8px 18px', fontSize: 14, background: id === device ? 'var(--color-accent-2-700)' : 'transparent', color: id === device ? 'var(--color-neutral-100)' : 'var(--color-neutral-800)' }}
                >{id}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-baseline gap-2.5" style={css('margin-top: -8px')}>
          <span style={css('font-family: var(--font-heading); font-size: 20px')}>{device}</span>
          <span style={css('font-size: 14px; color: var(--color-neutral-700)')}>{deviceReporting ? 'Reporting' : 'No recent data'}</span>
        </div>

        <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 16px')}>
          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 22px 24px; flex-direction: row; align-items: center; gap: 16px')}>
            <span style={css('display: inline-flex; align-items: center; justify-content: center; width: 46px; height: 46px; border-radius: 999px; background: var(--color-accent-2-200); color: var(--color-accent-2-900); font-family: var(--font-heading); font-size: 19px; flex: none')}>{connected}</span>
            <div style={css('min-width: 0')}>
              <div style={css('font-family: var(--font-heading); font-size: 22px; line-height: 1.15')}>{connected} router{connected === 1 ? '' : 's'} reporting</div>
              <div style={css('font-size: 13px; color: var(--color-neutral-700); margin-top: 2px')}>Live on the network right now</div>
            </div>
          </div>
          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 22px 24px; flex-direction: row; align-items: center; gap: 16px')}>
            <span style={{ width: 14, height: 14, borderRadius: 999, flex: 'none', background: v.dropped > 6 || healthErr ? 'var(--color-accent-600)' : 'var(--color-accent-2-600)' }} />
            <div style={css('min-width: 0')}>
              <div style={css('font-family: var(--font-heading); font-size: 22px; line-height: 1.15')}>{healthErr ? 'Needs a look' : spikeActive ? 'New signal waiting' : 'Everything healthy'}</div>
              <div style={css('font-size: 13px; color: var(--color-neutral-700); margin-top: 2px')}>{healthErr ? 'The system is not answering' : spikeActive ? 'One plant has something to report' : 'The system is answering normally'}</div>
            </div>
          </div>
          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 22px 24px; flex-direction: row; align-items: center; gap: 16px')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: 999, background: gapBg, color: gapFg, fontFamily: 'var(--font-heading)', fontSize: 17, flex: 'none' }}>{v.completeness.toFixed(0)}%</span>
            <div style={css('min-width: 0')}>
              <div style={css('font-family: var(--font-heading); font-size: 22px; line-height: 1.15')}>{v.seqs.length + (v.seqs.length === 1 ? ' reading successful' : ' readings successful')}</div>
              <div style={css('font-size: 13px; color: var(--color-neutral-700); margin-top: 2px')}>Out of the last {v.seqs.length + v.dropped} batches sent</div>
            </div>
          </div>
        </div>

        {spikeActive && (
          <div style={css('display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 18px; padding: 22px 26px; border-radius: var(--radius-lg); background: var(--color-accent-200); border: 1px solid var(--color-accent-400); box-shadow: var(--shadow-md)')}>
            <div className="flex items-start gap-4">
              <span style={css('width: 14px; height: 14px; margin-top: 6px; border-radius: 999px; background: var(--color-accent-600); animation: pulseDot 1s ease-in-out infinite alternate')} />
              <div>
                <div style={css('font-family: var(--font-heading); font-size: 22px; color: var(--color-accent-900)')}>Signal detected</div>
                <div style={css('font-size: 14px; color: var(--color-accent-900); margin-top: 4px')}>A signal rose clear of this plant’s resting level — {spike.mv.toFixed(1)} mV, where the alert level is {(spike.threshold ?? DEFAULT_THRESHOLD_MV).toFixed(1)} mV</div>
                <div style={css('font-size: 13px; color: var(--color-accent-800); margin-top: 2px')}>{fmtTime(spike.t)}  ·  {spike.t}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="tag tag-outline" style={css('border-radius: 999px; border-color: var(--color-accent-600); color: var(--color-accent-900)')}>{live ? 'from the sensor' : 'preview state'}</span>
              <button type="button" onClick={() => setAcked(true)} className="btn btn-primary" style={css('border-radius: 999px')}>Acknowledge</button>
            </div>
          </div>
        )}

        <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 22px; align-items: stretch')}>

          <div className="card elev-md" style={css('grid-column: 1 / -1; border-radius: var(--radius-lg); padding: 26px clamp(18px, 2.5vw, 30px)')}>
            <div className="flex flex-wrap items-center justify-between gap-3.5" style={css('margin-bottom: 20px')}>
              <div>
                <h2 className="card-title" style={css('margin: 0; font-size: 26px')}>Electrical activity</h2>
                <p className="card-body" style={css('margin: 4px 0 0; font-size: 14px')}>The green line is the plant’s signal strength in millivolts. The dashed line is its normal resting level — movement away from it means conditions around the plant have changed.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="tag" style={{ borderRadius: 999, background: isSim ? 'var(--color-accent-200)' : 'var(--color-accent-2-200)', color: isSim ? 'var(--color-accent-900)' : 'var(--color-accent-2-900)' }}>{isSim ? 'Simulated data — no plant connected' : 'Live plant — real sensor'}</span>
                <span className="tag tag-neutral" style={css('border-radius: 999px')}>resting level {baseline.toFixed(1)} mV</span>
                <span className="tag tag-neutral" style={css('border-radius: 999px')}>right now {v.current == null ? '—' : v.current.toFixed(1)} mV</span>
              </div>
            </div>
            <div className="flex gap-3.5" style={css('position: relative')}>
              <div style={css('position: relative; width: 40px; flex: none; height: 280px; font-size: 12px; color: var(--color-neutral-600); font-family: ui-monospace, monospace; text-align: right')}>
                {v.gridLines.map((g, i) => (
                  <span
                    key={g.value}
                    style={{ position: 'absolute', right: 0, top: g.y, transform: 'translateY(-50%)', whiteSpace: 'nowrap', fontWeight: g.value === 0 ? 700 : 400, color: g.value === 0 ? 'var(--color-neutral-900)' : undefined }}
                  >
                    {g.value}{i === v.gridLines.length - 1 ? ' mV' : ''}
                  </span>
                ))}
              </div>
              <div style={css('flex: 1; min-width: 0; height: 280px; border-radius: var(--radius-lg); background: var(--color-neutral-200); overflow: hidden')}>
                <svg viewBox="0 0 900 280" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
                  {v.gridLines.map((g) => (
                    <line key={g.value} x1="0" y1={g.y} x2="900" y2={g.y} stroke="#9a9081" strokeWidth={g.value === 0 ? 2 : 1} opacity={g.value === 0 ? 0.6 : 0.18} />
                  ))}
                  <line x1="0" y1={v.baselineY} x2="900" y2={v.baselineY} stroke="#9a9081" strokeWidth="1.5" strokeDasharray="7 7" />
                  <path d={v.areaPath} fill="color-mix(in srgb, #7a8a5e 22%, transparent)" />
                  <path d={v.linePath} fill="none" stroke="#56633f" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                  <path d={v.spikePath} fill="none" stroke="#c67139" strokeWidth="3" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
            <div style={css('display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; margin-top: 12px; font-size: 12px; color: var(--color-neutral-600); font-family: ui-monospace, monospace')}>
              <span>{v.s.length ? fmtTime(v.s[0].t) : '—'}</span>
              <span>{v.s.length} readings{live ? '' : ' · preview feed'}</span>
              <span>{v.s.length ? fmtTime(v.s[v.s.length - 1].t) : '—'}</span>
            </div>
          </div>

          <div className="card elev-sm" style={css('grid-column: 1 / -1; border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 14px')}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>Status over time</h2>
                <p className="card-body" style={css('margin: 4px 0 0; font-size: 14px')}>An hour-by-hour view of the last two days, once the backend keeps that history — today it only reports current status.</p>
              </div>
              <span className="tag tag-outline" style={css('border-radius: 999px')}>not live yet</span>
            </div>
          </div>

          <div className="card elev-md" style={css('grid-column: 1 / -1; border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 18px')}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>The site</h2>
                <p className="card-body" style={css('margin: 4px 0 0; font-size: 14px; max-width: 62ch')}>A schematic diagram of every real router on the network and how active each one is right now — positions here are just layout, not GPS/site placement (no location data exists for them yet).</p>
              </div>
            </div>
            {graph.nodes.length ? (
              <>
                <div style={css('position: relative; border-radius: var(--radius-lg); background: var(--color-neutral-200)')}>
                  <svg viewBox="0 0 600 300" style={{ width: '100%', height: 'auto', display: 'block' }}>
                    <rect x="0" y="0" width="600" height="300" fill="#e7dcc7" />
                    {graph.links.map((l, i) => {
                      const glow = Math.min(1, l.activity / FULL_GLOW_MV);
                      return (
                        <line key={'l' + i} x1={graph.nodes[l.a].x} y1={graph.nodes[l.a].y} x2={graph.nodes[l.b].x} y2={graph.nodes[l.b].y}
                          stroke={glow > 0.15 ? '#c67139' : '#8c491a'} strokeWidth={glow > 0.15 ? 2.5 : 2} strokeDasharray="6 6" opacity={(0.25 + glow * 0.65).toFixed(2)} />
                      );
                    })}
                    {graph.nodes.map((n) => {
                      const glow = Math.min(1, n.activity / FULL_GLOW_MV);
                      const fill = glow > 0.5 ? 'var(--color-accent-500)' : 'var(--color-accent-2-500)';
                      const dot = glow > 0.5 ? 'var(--color-accent-900)' : 'var(--color-accent-2-900)';
                      return (
                        <g key={'n' + n.id} onMouseEnter={() => setHoverId('map-' + n.id)} onMouseLeave={() => setHoverId(null)} style={{ cursor: 'pointer' }}>
                          <circle cx={n.x} cy={n.y} r={18} fill={fill} opacity={0.4 + glow * 0.4} />
                          <circle cx={n.x} cy={n.y} r={15} fill={fill} />
                          <circle cx={n.x} cy={n.y} r="6" fill={dot} />
                        </g>
                      );
                    })}
                  </svg>
                  {graph.nodes.map((n) => hoverId === 'map-' + n.id && (
                    <span key={'t' + n.id} style={{ position: 'absolute', left: ((n.x / 600) * 100).toFixed(1) + '%', top: ((n.y / 300) * 100).toFixed(1) + '%', transform: 'translate(-50%, -140%)', zIndex: 40, whiteSpace: 'nowrap', padding: '9px 14px', borderRadius: 'var(--radius-lg)', background: 'var(--color-neutral-900)', color: 'var(--color-neutral-100)', fontSize: 13, boxShadow: 'var(--shadow-md)', pointerEvents: 'none' }}>
                      {n.id} · {n.activity.toFixed(1)} mV activity
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {graph.nodes.map((n) => {
                    const glow = Math.min(1, n.activity / FULL_GLOW_MV);
                    const bg = glow > 0.5 ? 'var(--color-accent-200)' : 'var(--color-accent-2-200)';
                    const fg = glow > 0.5 ? 'var(--color-accent-900)' : 'var(--color-accent-2-900)';
                    return (
                      <span key={'c' + n.id} className="tag" style={{ borderRadius: 999, background: bg, color: fg }}>
                        {n.id} · {n.activity.toFixed(1)} mV activity
                      </span>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="card-body" style={css('margin: 0; font-size: 14px; color: var(--color-neutral-600)')}>No routers reporting yet.</p>
            )}
          </div>

          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 16px')}>
            <div>
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>Conditions</h2>
              <p className="card-body" style={css('margin: 4px 0 0; font-size: 14px')}>Each router measures these alongside the electrical signal, because weather shapes how a plant reacts.</p>
            </div>
            <div style={css('flex: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 1fr; gap: 12px')}>
              <div style={css('display: flex; flex-direction: column; justify-content: center; padding: 14px 16px; border-radius: var(--radius-lg); background: var(--color-neutral-200); min-width: 0')}>
                <div style={css('font-family: var(--font-heading); font-size: 24px; line-height: 1.1')}>{soilMv != null ? soilMv.toFixed(0) + ' mV' : '—'}</div>
                <div style={css('font-size: 13px; color: var(--color-neutral-700); margin-top: 3px')}>Soil moisture (raw)</div>
              </div>
            </div>
            <p style={css('margin: 0; font-size: 13px; color: var(--color-neutral-600)')}>Air humidity, temperature and light aren't measured yet — no sensor for them exists in the hardware.</p>
          </div>

          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 14px')}>
            <div>
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>Ecology news</h2>
              <p className="card-body" style={css('margin: 4px 0 0; font-size: 14px')}>Wider context from outside the network, refreshed from real ecology/environment sources.</p>
            </div>
            {news.length ? (
              <ul style={css('display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; list-style: none')}>
                {news.map((n) => (
                  <li key={n.id} style={css('display: flex; flex-direction: column; gap: 2px')}>
                    <a href={n.link} target="_blank" rel="noreferrer" style={css('font-size: 14px; font-weight: 600; color: var(--color-neutral-900); text-decoration: none')}>{n.title}</a>
                    <span style={css('font-size: 12px; color: var(--color-neutral-600)')}>{n.source} · {fmtAgo(n.published_ts)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="card-body" style={css('margin: 0; font-size: 14px; color: var(--color-neutral-600)')}>No news fetched yet.</p>
            )}
          </div>

          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 16px')}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>Router activity</h2>
              <span className="tag tag-neutral" style={css('border-radius: 999px')}>{network.nodes.length} reporting</span>
            </div>
            <p className="card-body" style={css('margin: 0; font-size: 14px')}>Each router's current electrical activity, in millivolts. A flat bar means a router has dropped off the network.</p>
            {network.nodes.length ? (
              <div className="flex flex-col gap-3">
                {network.nodes.map((n) => {
                  const pct = Math.min(100, (n.activity / FULL_GLOW_MV) * 100);
                  return (
                    <div key={'tr' + n.device} className="flex flex-col gap-1.5">
                      <div style={css('display: flex; justify-content: space-between; font-size: 13px')}>
                        <span style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-800)')}>{n.device}</span>
                        <span style={css('color: var(--color-neutral-700)')}>{n.activity.toFixed(1)} mV</span>
                      </div>
                      <div style={css('height: 10px; border-radius: 999px; background: var(--color-neutral-200); overflow: hidden')}>
                        <div style={{ height: '100%', width: pct.toFixed(0) + '%', borderRadius: 999, background: pct > 15 ? 'var(--color-accent-2-600)' : 'var(--color-accent-600)' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="card-body" style={css('margin: 0; font-size: 14px; color: var(--color-neutral-600)')}>No routers reporting yet.</p>
            )}
          </div>

          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; justify-content: space-between; gap: 16px')}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>Download the data</h2>
              <span className="tag tag-neutral" style={css('border-radius: 999px')}>{samples.length} readings</span>
            </div>
            <p className="card-body" style={css('margin: 0; font-size: 14px')}>Take the readings currently loaded into a spreadsheet, or as raw JSON for analysis.</p>
            <div className="flex flex-wrap gap-2.5">
              <button type="button" onClick={() => download('csv')} className="btn btn-primary" style={css('border-radius: 999px; padding: 12px 24px')}>CSV for spreadsheets</button>
              <button type="button" onClick={() => download('json')} className="btn btn-secondary" style={css('border-radius: 999px; padding: 12px 24px')}>JSON</button>
            </div>
            <p style={css('margin: 0; font-size: 13px; color: var(--color-neutral-600)')}>{exportNote || 'Downloads the readings on screen right now.'}</p>
          </div>

          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 16px')}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>Router connection</h2>
              <span style={css('display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--color-neutral-800)')}>
                <span style={{ width: 9, height: 9, borderRadius: 999, background: online ? 'var(--color-accent-2-600)' : healthErr ? 'var(--color-accent-600)' : 'var(--color-neutral-400)' }} />
                {online ? 'ok' : healthErr ? 'unreachable' : 'checking'}
              </span>
            </div>
            <div style={css('display: grid; grid-template-columns: 1fr auto; gap: 12px 16px; font-size: 14px')}>
              <span style={css('color: var(--color-neutral-700)')}>Readings received</span>
              <span style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-900)')}>{health && health.batches != null ? health.batches.toLocaleString() : '—'}</span>
              <span style={css('color: var(--color-neutral-700)')}>Last reading</span>
              <span style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-900)')}>{ago}</span>
              <span style={css('color: var(--color-neutral-700)')}>Routers reporting</span>
              <span style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-900)')}>{health && health.devices && health.devices.length ? health.devices.join(', ') : '—'}</span>
              <span style={css('color: var(--color-neutral-700)')}>Checked</span>
              <span style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-700)')}>every 10s</span>
            </div>
          </div>

          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 16px')}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>Data completeness</h2>
              <span className="tag" style={{ borderRadius: 999, background: gapBg, color: gapFg }}>{v.dropped ? v.seqs.length + ' of ' + (v.seqs.length + v.dropped) + ' arrived' : 'all arrived'}</span>
            </div>
            <p className="card-body" style={css('margin: 0; font-size: 14px')}>Each bar is a batch of readings. Orange bars mark readings that never arrived, so a quiet patch in the chart is never mistaken for a quiet plant.</p>
            <div className="flex items-end" style={css('gap: 3px; height: 46px')}>
              {v.seqs.slice(-40).map((val, i, a) => {
                const gap = i > 0 && val - a[i - 1] > 1;
                return <span key={i} style={{ flex: 1, borderRadius: '999px 999px 3px 3px', height: gap ? 46 : 16 + (val % 5) * 5, background: gap ? 'var(--color-accent-600)' : 'var(--color-accent-2-400)' }} />;
              })}
            </div>
            <div style={css('display: grid; grid-template-columns: 1fr auto; gap: 10px 16px; font-size: 14px')}>
              <span style={css('color: var(--color-neutral-700)')}>Batches shown</span>
              <span style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-900)')}>{v.seqs.length || '—'}</span>
              <span style={css('color: var(--color-neutral-700)')}>Received</span>
              <span style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-900)')}>{v.seqs.length + ' / ' + (v.seqs.length + v.dropped)}</span>
              <span style={css('color: var(--color-neutral-700)')}>Latest batch no.</span>
              <span style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-900)')}>{v.seqs.length ? v.seqs[v.seqs.length - 1] : '—'}</span>
            </div>
          </div>

        </div>

        <Copyright />
      </main>
    </div>
  );
}
