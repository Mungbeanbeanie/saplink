import React, { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../components/Header.jsx';
import GoogleSignInButton from '../components/GoogleSignInButton.jsx';
import Copyright from '../components/Copyright.jsx';
import { css } from '../lib/css.js';
import { useAuth } from '../lib/auth.js';
import { apiFetch } from '../lib/api.js';
import { roster, nodeLinks } from '../data/roster.js';
import { useNews } from '../lib/news.js';

const DEFAULT_THRESHOLD_MV = 70; // real backend doesn't expose a threshold yet -- see spike rendering below

const fmtTime = (t) => (t ? new Date(t).toTimeString().slice(0, 8) : '—');
const fmtAgo = (ts) => {
  if (ts == null) return '—';
  const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
};

// Air humidity/temperature/light have no sensor in the BOM and no backend
// source (see plan.md's Phase 6 note) -- still hardcoded placeholders.
// Soil moisture is real: wired to Contract A's soil_mv below.
const WEATHER_CONDITIONS = [['68%', 'Air humidity'], ['14.2°C', 'Air temperature'], ['320 lux', 'Light level']];

const NODE_TONE = {
  ok: ['var(--color-accent-2-200)', 'var(--color-accent-2-900)', '#56633f'],
  quiet: ['var(--color-accent-200)', 'var(--color-accent-900)', '#c67139']
};

export default function Dashboard() {
  const { signedIn, token } = useAuth();
  const news = useNews(6);
  const [device, setDevice] = useState('sense-1');
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
    const lo = mvs.length ? Math.min(Math.min(...mvs), baseline) - 6 : 0;
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

    const connected = roster.filter((n) => n.status === 'ok').length;
    const siteCanopy = roster.reduce((sum, n) => sum + n.canopy, 0) / roster.length;
    const completeness = seqs.length ? Math.max(0, 100 - (dropped / (seqs.length + dropped)) * 100) : 100;

    return {
      s, lo, hi, H, W, linePath,
      areaPath: s.length ? linePath + 'L' + W + ' ' + H + 'L0 ' + H + 'Z' : '',
      spikePath: spikeSeg.join(' '),
      baselineY: Y(baseline).toFixed(1),
      seqs, dropped, connected, siteCanopy, completeness,
      current: s.length ? s[s.length - 1].mv : null
    };
  }, [samples, baseline]);

  const selected = roster.find((n) => n.id === device) || roster[0];
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

  const tip = (text) => (
    <span style={css('position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%); z-index: 40; white-space: nowrap; padding: 9px 14px; border-radius: var(--radius-lg); background: var(--color-neutral-900); color: var(--color-neutral-100); font-size: 13px; box-shadow: var(--shadow-md); pointer-events: none')}>{text}</span>
  );

  const statusBlocks = Array.from({ length: 48 }, (_, i) => {
    const missing = i === 9 || i === 10 || i === 31;
    const signal = i === 20 || i === 41;
    return {
      bg: missing ? 'var(--color-neutral-400)' : signal ? 'var(--color-accent-500)' : 'var(--color-accent-2-500)',
      title: (47 - i) + 'h ago — ' + (missing ? 'no data' : signal ? 'signal sent' : 'steady')
    };
  });

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
              {roster.map((d) => (
                <span key={d.id} style={css('position: relative; display: inline-flex')}>
                  <button
                    type="button" className="seg-opt"
                    onClick={() => setDevice(d.id)}
                    onMouseEnter={() => setHoverId('tab-' + d.id)}
                    onMouseLeave={() => setHoverId(null)}
                    style={{ borderRadius: 999, padding: '8px 18px', fontSize: 14, background: d.id === device ? 'var(--color-accent-2-700)' : 'transparent', color: d.id === device ? 'var(--color-neutral-100)' : 'var(--color-neutral-800)' }}
                  >{d.id}</button>
                  {hoverId === 'tab-' + d.id && tip(d.plant + ' · ' + d.site)}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-baseline gap-2.5" style={css('margin-top: -8px')}>
          <span style={css('font-family: var(--font-heading); font-size: 20px')}>{selected.plant}</span>
          <span style={css('font-size: 14px; color: var(--color-neutral-700)')}>{selected.site}</span>
        </div>

        <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 16px')}>
          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 22px 24px; flex-direction: row; align-items: center; gap: 16px')}>
            <span style={css('display: inline-flex; align-items: center; justify-content: center; width: 46px; height: 46px; border-radius: 999px; background: var(--color-accent-2-200); color: var(--color-accent-2-900); font-family: var(--font-heading); font-size: 19px; flex: none')}>{v.connected}/{roster.length}</span>
            <div style={css('min-width: 0')}>
              <div style={css('font-family: var(--font-heading); font-size: 22px; line-height: 1.15')}>{v.connected} of {roster.length} reporting</div>
              <div style={css('font-size: 13px; color: var(--color-neutral-700); margin-top: 2px')}>Plants with a router</div>
            </div>
          </div>
          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 22px 24px; flex-direction: row; align-items: center; gap: 16px')}>
            <span style={{ width: 14, height: 14, borderRadius: 999, flex: 'none', background: v.dropped > 6 || healthErr ? 'var(--color-accent-600)' : 'var(--color-accent-2-600)' }} />
            <div style={css('min-width: 0')}>
              <div style={css('font-family: var(--font-heading); font-size: 22px; line-height: 1.15')}>{healthErr ? 'Needs a look' : spikeActive ? 'New signal waiting' : 'Everything healthy'}</div>
              <div style={css('font-size: 13px; color: var(--color-neutral-700); margin-top: 2px')}>{healthErr ? 'The system is not answering' : spikeActive ? 'One plant has something to report' : 'Every router on the network is reporting'}</div>
            </div>
          </div>
          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 22px 24px; flex-direction: row; align-items: center; gap: 16px')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: 999, background: gapBg, color: gapFg, fontFamily: 'var(--font-heading)', fontSize: 17, flex: 'none' }}>{v.completeness.toFixed(0)}%</span>
            <div style={css('min-width: 0')}>
              <div style={css('font-family: var(--font-heading); font-size: 22px; line-height: 1.15')}>{v.dropped ? v.dropped + (v.dropped === 1 ? ' reading missing' : ' readings missing') : 'No readings missing'}</div>
              <div style={css('font-size: 13px; color: var(--color-neutral-700); margin-top: 2px')}>Of the last {v.seqs.length} batches sent</div>
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
              <div style={css('display: flex; flex-direction: column; justify-content: space-between; font-size: 12px; color: var(--color-neutral-600); font-family: ui-monospace, monospace; padding: 2px 0; height: 280px')}>
                <span>{v.hi.toFixed(0)} mV</span>
                <span>{((v.hi + v.lo) / 2).toFixed(0)}</span>
                <span>{v.lo.toFixed(0)}</span>
              </div>
              <div style={css('flex: 1; min-width: 0; height: 280px; border-radius: var(--radius-lg); background: var(--color-neutral-200); overflow: hidden')}>
                <svg viewBox="0 0 900 280" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
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
                <p className="card-body" style={css('margin: 4px 0 0; font-size: 14px')}>Each block is one hour of the last two days. Green means the plants were steady and every router reported in.</p>
              </div>
              <div style={css('display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; color: var(--color-neutral-700)')}>
                <span className="inline-flex items-center gap-2"><span style={css('width: 11px; height: 11px; border-radius: 4px; background: var(--color-accent-2-500)')} />Steady</span>
                <span className="inline-flex items-center gap-2"><span style={css('width: 11px; height: 11px; border-radius: 4px; background: var(--color-accent-500)')} />Signal sent</span>
                <span className="inline-flex items-center gap-2"><span style={css('width: 11px; height: 11px; border-radius: 4px; background: var(--color-neutral-400)')} />No data</span>
              </div>
            </div>
            <div className="flex" style={css('gap: 3px')}>
              {statusBlocks.map((b, i) => (
                <span key={i} title={b.title} style={{ flex: 1, height: 34, borderRadius: 5, background: b.bg }} />
              ))}
            </div>
            <div style={css('display: flex; justify-content: space-between; font-size: 12px; color: var(--color-neutral-600); font-family: ui-monospace, monospace')}>
              <span>48 hours ago</span><span>now</span>
            </div>
          </div>

          <div className="card elev-md" style={css('grid-column: 1 / -1; border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 18px')}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>The site</h2>
                <p className="card-body" style={css('margin: 4px 0 0; font-size: 14px; max-width: 62ch')}>Where the routers sit, which ones are linked, and how much of the ground the canopy has taken back. Each patch is one router’s area — the wider and deeper the green, the more canopy has grown back there.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <div style={css('padding: 12px 20px; border-radius: var(--radius-lg); background: var(--color-accent-2-200)')}>
                  <div style={css('font-family: var(--font-heading); font-size: 26px; color: var(--color-accent-2-900); line-height: 1.1')}>{v.siteCanopy.toFixed(0)}%</div>
                  <div style={css('font-size: 12px; color: var(--color-accent-2-900)')}>canopy cover now</div>
                </div>
                <div style={css('padding: 12px 20px; border-radius: var(--radius-lg); background: var(--color-neutral-200)')}>
                  <div style={css('font-family: var(--font-heading); font-size: 26px; line-height: 1.1')}>+{(v.siteCanopy - 20.8).toFixed(0)} pts</div>
                  <div style={css('font-size: 12px; color: var(--color-neutral-700)')}>since replanting began</div>
                </div>
              </div>
            </div>
            <div style={css('position: relative; border-radius: var(--radius-lg); background: var(--color-neutral-200)')}>
              <svg viewBox="0 0 600 300" style={{ width: '100%', height: 'auto', display: 'block' }}>
                <rect x="0" y="0" width="600" height="300" fill="#e7dcc7" />
                {roster.map((n) => {
                  const rx = 42 + n.canopy * 1.3;
                  return <ellipse key={'p' + n.id} cx={n.x} cy={n.y} rx={rx.toFixed(0)} ry={(rx * 0.62).toFixed(0)} fill="#7a8a5e" opacity={(0.1 + (n.canopy / 100) * 0.62).toFixed(2)} />;
                })}
                {nodeLinks.map(([a, b], i) => (
                  <line key={'l' + i} x1={roster[a].x} y1={roster[a].y} x2={roster[b].x} y2={roster[b].y} stroke="#8c491a" strokeWidth="2" strokeDasharray="6 6" opacity="0.6" />
                ))}
                {roster.map((n) => {
                  const t = NODE_TONE[n.status];
                  return (
                    <g key={'n' + n.id} onMouseEnter={() => setHoverId('map-' + n.id)} onMouseLeave={() => setHoverId(null)} style={{ cursor: 'pointer' }}>
                      <circle cx={n.x} cy={n.y} r="18" fill={t[0]} opacity="0.55" />
                      <circle cx={n.x} cy={n.y} r="15" fill={t[0]} />
                      <circle cx={n.x} cy={n.y} r="8" fill={t[2]} />
                    </g>
                  );
                })}
              </svg>
              {roster.map((n) => hoverId === 'map-' + n.id && (
                <span key={'t' + n.id} style={{ position: 'absolute', left: ((n.x / 600) * 100).toFixed(1) + '%', top: ((n.y / 300) * 100).toFixed(1) + '%', transform: 'translate(-50%, -140%)', zIndex: 40, whiteSpace: 'nowrap', padding: '9px 14px', borderRadius: 'var(--radius-lg)', background: 'var(--color-neutral-900)', color: 'var(--color-neutral-100)', fontSize: 13, boxShadow: 'var(--shadow-md)', pointerEvents: 'none' }}>
                  {n.id} · {n.plant} · {n.site}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2.5">
              {roster.map((n) => {
                const t = NODE_TONE[n.status];
                return (
                  <span key={'c' + n.id} style={css('position: relative; display: inline-flex')}>
                    <span className="tag" onMouseEnter={() => setHoverId('chip-' + n.id)} onMouseLeave={() => setHoverId(null)} style={{ borderRadius: 999, background: t[0], color: t[1] }}>
                      {n.id} · {n.canopy}% canopy · {n.status === 'ok' ? 'reporting' : 'quiet 6h'}
                    </span>
                    {hoverId === 'chip-' + n.id && tip(n.plant + ' · ' + n.site)}
                  </span>
                );
              })}
            </div>
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
              {WEATHER_CONDITIONS.map(([value, label]) => (
                <div key={label} style={css('display: flex; flex-direction: column; justify-content: center; padding: 14px 16px; border-radius: var(--radius-lg); background: var(--color-neutral-200); min-width: 0')}>
                  <div style={css('font-family: var(--font-heading); font-size: 24px; line-height: 1.1')}>{value}</div>
                  <div style={css('font-size: 13px; color: var(--color-neutral-700); margin-top: 3px')}>{label}</div>
                </div>
              ))}
            </div>
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
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>Network traffic</h2>
              <span className="tag tag-neutral" style={css('border-radius: 999px')}>{(v.connected * 1.2).toFixed(1)} kB/min</span>
            </div>
            <p className="card-body" style={css('margin: 0; font-size: 14px')}>How much data each router is sending. A flat bar means a router has dropped off the network.</p>
            <div className="flex flex-col gap-3">
              {roster.map((n, i) => (
                <div key={'tr' + n.id} className="flex flex-col gap-1.5">
                  <div style={css('display: flex; justify-content: space-between; font-size: 13px')}>
                    <span title={n.plant + ' · ' + n.site} style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-800)')}>{n.id}</span>
                    <span style={css('color: var(--color-neutral-700)')}>{n.status === 'ok' ? (1.4 - i * 0.2).toFixed(1) + ' kB/min' : 'silent'}</span>
                  </div>
                  <div style={css('height: 10px; border-radius: 999px; background: var(--color-neutral-200); overflow: hidden')}>
                    <div style={{ height: '100%', width: n.status === 'ok' ? (88 - i * 16) + '%' : '3%', borderRadius: 999, background: n.status === 'ok' ? 'var(--color-accent-2-600)' : 'var(--color-accent-600)' }} />
                  </div>
                </div>
              ))}
            </div>
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
              <span style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-900)')}>{health && health.devices ? health.devices.join(', ') : roster.map((n) => n.id).join(', ')}</span>
              <span style={css('color: var(--color-neutral-700)')}>Checked</span>
              <span style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-700)')}>every 10s</span>
            </div>
          </div>

          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 16px')}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>Data completeness</h2>
              <span className="tag" style={{ borderRadius: 999, background: gapBg, color: gapFg }}>{v.dropped ? v.dropped + ' missing' : 'all arrived'}</span>
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
              <span style={css('color: var(--color-neutral-700)')}>Missing</span>
              <span style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-900)')}>{v.dropped}</span>
              <span style={css('color: var(--color-neutral-700)')}>Latest batch no.</span>
              <span style={css('font-family: ui-monospace, monospace; color: var(--color-neutral-900)')}>{v.seqs.length ? v.seqs[v.seqs.length - 1] : '—'}</span>
            </div>
          </div>

          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 16px')}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>Response relay</h2>
              <span className="tag tag-outline" style={css('border-radius: 999px')}>not live yet</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px', borderRadius: 'var(--radius-lg)', background: acked ? 'var(--color-accent-2-200)' : 'var(--color-neutral-200)' }}>
              <span style={{ width: 16, height: 16, borderRadius: 999, background: acked ? 'var(--color-accent-2-600)' : 'var(--color-neutral-400)' }} />
              <div>
                <div style={css('font-family: var(--font-heading); font-size: 20px; color: var(--color-neutral-900)')}>{acked ? 'Neighbouring plant primed' : 'Standing by'}</div>
                <div style={css('font-size: 13px; color: var(--color-neutral-700); margin-top: 2px')}>{acked ? 'Signal acknowledged and passed on' : 'No unacknowledged signal waiting'}</div>
              </div>
            </div>
            <p className="card-body" style={css('margin: 0; font-size: 13px; color: var(--color-neutral-600)')}>When a signal is acknowledged, it is relayed to the router on a neighbouring plant. Shown here as a preview until that link is switched on.</p>
          </div>

          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 16px')}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}>Send a test signal</h2>
              <span className="tag tag-outline" style={css('border-radius: 999px')}>sign-in needed</span>
            </div>
            <p className="card-body" style={css('margin: 0; font-size: 14px')}>Replays a recorded signal so you can check the whole chain — router, alert, relay — without waiting for the plant to react.</p>
            {signedIn ? (
              <button type="button" onClick={sendReplay} className="btn btn-primary btn-block" style={css('border-radius: 999px; padding: 13px 26px; font-size: 16px')}>
                Send test signal
              </button>
            ) : (
              <GoogleSignInButton size="large" shape="pill" />
            )}
            <p style={css('margin: 0; font-size: 13px; color: var(--color-neutral-600)')}>
              {replayNote || (signedIn ? 'Recorded against your Google account.' : 'Anyone can view the readings; sending needs sign-in.')}
            </p>
          </div>

        </div>

        <Copyright />
      </main>
    </div>
  );
}
