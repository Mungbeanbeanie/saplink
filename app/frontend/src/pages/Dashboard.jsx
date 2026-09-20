import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header.jsx';
import GoogleSignInButton from '../components/GoogleSignInButton.jsx';
import Footer from '../components/Footer.jsx';
import Mascot from '../components/Mascot.jsx';
import MascotSpinner from '../components/MascotSpinner.jsx';
import FadeWords from '../components/FadeWords.jsx';
import { css } from '../lib/css.js';
import { useAuth } from '../lib/auth.js';
import { apiFetch } from '../lib/api.js';
import { useNetwork } from '../lib/network.js';
import { useStatusHistory } from '../lib/statusHistory.js';
import { useWeather } from '../lib/weather.js';

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

// Andrew's monotone chain -- returns hull vertices in CCW order. Fewer than
// 3 points can't form a 2D hull, so they're returned unchanged.
function convexHull(points) {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// True AREA centroid of the hull polygon (shoelace formula), not a plain
// vertex average -- an average skews toward whichever side of the hull has
// more/closer-together points. Falls back to a coordinate average for <3
// points or a degenerate/collinear (zero-area) hull, where the area-weighted
// formula would divide by ~0.
function polygonCentroid(hull) {
  if (hull.length < 3) {
    const n = hull.length;
    return {
      x: hull.reduce((s, p) => s + p.x, 0) / n,
      y: hull.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-6) {
    const n = hull.length;
    return {
      x: hull.reduce((s, p) => s + p.x, 0) / n,
      y: hull.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

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
  const moistureCenter = nodes.length ? polygonCentroid(convexHull(nodes)) : { x: 300, y: 150 };
  return { nodes, links, moistureCenter };
}
// mV that counts as "fully lit" -- a tuned display heuristic, not a
// calibrated threshold; revisit against real VP amplitudes once more devices
// report.
const FULL_GLOW_MV = 5;

// Real per-probe calibration, measured by air/water dip -- see
// esp32/Saplink/src/soil_main.cpp's kDryMv/kWetMv (comment there: "the two
// differ by 21mV dry and 45mV wet ... a shared constant would quietly bias
// one plant against the other"). HIGHER raw mV is DRIER, confirmed by that
// file's own moisturePct() formula -- inverted below. Used ONLY to size/color
// the site map's moisture glow, never rendered as a number: the dashboard
// still shows raw mV, matching main.py/combo_main.cpp's "map both at once, or
// neither" decision to not put a % next to a raw-mV trace. Re-measure if a
// probe is swapped or reseated -- these are physical constants, not tunable.
const SOIL_CALIBRATION = {
  'sense-1': { dry: 2154, wet: 865 },
  'sense-2': { dry: 2175, wet: 910 },
};
function wetFraction(device, soilMv) {
  if (soilMv == null) return null;
  const cal = SOIL_CALIBRATION[device] || SOIL_CALIBRATION['sense-1'];
  return Math.min(1, Math.max(0, (cal.dry - soilMv) / (cal.dry - cal.wet)));
}

const DEFAULT_THRESHOLD_MV = 70; // real backend doesn't expose a threshold yet -- see spike rendering below

// Range the "site" card's thermometer bar maps 0-100% fill across -- a tuned
// display heuristic (same convention as FULL_GLOW_MV above), not a
// calibrated comfort/danger range.
const TEMP_MIN_F = 20;
const TEMP_MAX_F = 100;

const fmtTime = (t) => (t ? new Date(t).toTimeString().slice(0, 8) : '—');
const fmtAgo = (ts) => {
  if (ts == null) return '—';
  const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
};
const fmtHour = (epochSeconds) => new Date(epochSeconds * 1000).toLocaleString([], {
  month: 'short', day: 'numeric', hour: 'numeric',
});

// "Nice" tick step (the standard D3-style 1/2/5 x 10^n ladder) for a target
// gridline count -- a fixed 10mV step looked fine at everyday scale, but
// during an absurd spike the lo..hi range can balloon into the hundreds of
// mV, and a fixed step then draws dozens of gridlines into the same 280px
// of chart height, compressing the labels into an unreadable stack. Scaling
// the step to the range keeps roughly the same number of gridlines (and so
// legible spacing) whether the plant is calm or spiking.
function niceStep(range, targetTicks) {
  if (!(range > 0)) return 10;
  const rawStep = range / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  const niceResidual = residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1;
  return niceResidual * magnitude;
}

export default function Dashboard() {
  const { signedIn, token } = useAuth();
  const network = useNetwork();
  const weather = useWeather();
  const graph = useMemo(() => buildSiteGraph(network.nodes), [network.nodes]);
  // Across every real reporting probe right now, not just the selected tab --
  // built to generalize as more probes join, not just today's two. avgWetFrac
  // averages each node's OWN wetness fraction (its own dry/wet calibration),
  // not raw mV, since sense-1/sense-2 aren't on the same scale.
  const soilStats = useMemo(() => {
    const readings = network.nodes
      .filter((n) => n.soil_mv != null)
      .map((n) => ({ mv: n.soil_mv, wetFrac: wetFraction(n.device, n.soil_mv) }));
    if (!readings.length) return null;
    const mvs = readings.map((r) => r.mv);
    const fracs = readings.map((r) => r.wetFrac).filter((f) => f != null);
    return {
      min: Math.min(...mvs),
      max: Math.max(...mvs),
      avgMv: mvs.reduce((a, b) => a + b, 0) / mvs.length,
      avgWetFrac: fracs.length ? fracs.reduce((a, b) => a + b, 0) / fracs.length : null,
    };
  }, [network.nodes]);
  const [searchParams] = useSearchParams();
  // Arriving from Account's "View" button (?device=sense-2) pre-selects that
  // router's tab. There's no fixed device roster to validate against
  // anymore -- an id that turns out not to be real just won't show up in the
  // tab list once /api/health answers.
  const [device, setDevice] = useState(() => searchParams.get('device') || 'sense-1');
  const statusHours = useStatusHistory(device);
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
  const [exportKind, setExportKind] = useState('csv');
  const lastId = useRef(0);

  // Readings: the API when it answers, a labelled preview feed when it does not.
  // Keyed on `device` (the backend now supports ?device= filtering) so
  // switching tabs restarts cleanly for the new router instead of mixing in
  // whichever device's batch last arrived -- lastId/samples all reset,
  // since they're otherwise stale state from the previous tab.
  useEffect(() => {
    lastId.current = 0;
    setSamples([]);
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

    const tick = () => apiFetch('/api/readings/history?since_id=' + lastId.current + '&device=' + encodeURIComponent(device))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(ingest, mock);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [device]);

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
    // `baseline` (the electrode's absolute standing potential) is NOT folded
    // in here -- mv[] is already a baseline-subtracted deviation (mean ~0 by
    // construction), a different scale entirely, so mixing the two stretched
    // the axis and made the resting line render nowhere near the signal.
    const lo = Math.min(0, mvs.length ? Math.min(...mvs) - 6 : 0);
    const hi = mvs.length ? Math.max(...mvs) + 6 : 100;
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

    // Horizontal gridlines, snapped to the current lo/hi range -- recomputed
    // here each time that range changes, so they track live data. The step
    // itself autoscales (niceStep above) so a spike widening the range
    // doesn't compress a fixed step into overlapping labels.
    const GRID_STEP = niceStep(hi - lo, 6);
    const gridLines = [];
    for (let val = Math.ceil(lo / GRID_STEP) * GRID_STEP; val <= hi; val += GRID_STEP) {
      gridLines.push({ value: val, y: Y(val) });
    }

    return {
      s, lo, hi, H, W, linePath, gridLines,
      areaPath: s.length ? linePath + 'L' + W + ' ' + H + 'L0 ' + H + 'Z' : '',
      spikePath: spikeSeg.join(' '),
      seqs, dropped, completeness,
      current: s.length ? s[s.length - 1].mv : null
    };
  }, [samples]);

  // Real devices only -- from /api/health, not a fixed fake fleet. Falls
  // back to just the currently-selected id before the first health poll
  // answers, so the tab bar is never empty.
  const devices = health && health.devices && health.devices.length ? health.devices : [device];
  const connected = health && health.devices ? health.devices.length : 0;
  const tempF = weather.temperature_f;
  const tempFrac = tempF == null ? null : Math.min(1, Math.max(0, (tempF - TEMP_MIN_F) / (TEMP_MAX_F - TEMP_MIN_F)));
  const spikeActive = !!spike && !acked;
  const isSim = src !== 'ads1115';
  const online = !!(health && health.ok);
  const ago = fmtAgo(health && health.last_recv);
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

  // "Status over time" below is real now (GET /api/status_history) -- one
  // block per hour, colored client-side from each hour's {batches,events}.
  // "Response relay" further down is still an honest "not live yet"
  // placeholder -- that one's blocked on the backend's still-unbuilt
  // pending-actuation mechanism (plan.md Phase 5), not a frontend gap.

  return (
    <>
    <div style={css('min-height: 100vh; background: var(--color-bg)')}>
      <Header />
      <main style={css('padding: clamp(20px, 3vw, 40px) clamp(20px, 5vw, 64px) 80px; display: flex; flex-direction: column; gap: 22px')}>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="card-kicker" style={css('margin-bottom: 6px')}><FadeWords text="Live monitoring" /></div>
            <h1 style={css('margin: 0; font-size: clamp(30px, 4vw, 50px); line-height: 1.05')}><FadeWords text="The" delayOffset={70} /> <span style={css('color: #743f1e')}><FadeWords text="Root" delayOffset={98} /></span> <FadeWords text="Directory" delayOffset={126} /></h1>
            <p style={css('margin: 10px 0 0; max-width: 60ch; font-size: 15px; line-height: 1.6; color: var(--color-neutral-700)')}>
              <FadeWords delayOffset={220} text="Every plant on the network has its own router. Plants change their electrical activity as conditions change — more water, more light, a wound, a dry spell — and when that activity moves clear of the plant’s resting level the router puts it on the network, reaching this page within seconds." />
            </p>
          </div>
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

          <div className="card elev-md" style={css('grid-column: 1 / -1; border-radius: var(--radius-lg); padding: 26px clamp(18px, 2.5vw, 30px); position: relative')}>
            <div className="flex flex-wrap items-start justify-between gap-3.5" style={css('margin-bottom: 14px; padding-top: 32px')}>
              <div>
                <h2 className="card-title" style={css('margin: 0; font-size: 26px')}><FadeWords text="Electrical activity" /></h2>
                <p className="card-body" style={css('margin: 4px 0 0; font-size: 14px')}><FadeWords delayOffset={40} text="The line shows the plant’s signal strength in millivolts, already measured relative to its own resting point." /></p>
              </div>
              <div className="flex items-center gap-2.5" style={css('position: absolute; top: 22px; right: 18px')}>
                <span style={css('font-size: 15px; font-weight: 700; color: var(--color-neutral-900)')}>Download as</span>
                <select value={exportKind} onChange={(e) => setExportKind(e.target.value)} aria-label="Download format" style={css('border-radius: 999px; padding: 7px 12px; font-size: 13px; border: 1px solid var(--color-neutral-300); background: var(--color-neutral-100)')}>
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
                <button type="button" onClick={() => download(exportKind)} disabled={!samples.length} className="btn btn-primary" title="Downloads the readings on screen right now" style={css('border-radius: 999px; padding: 8px 18px; font-size: 13px; font-weight: 500')}>Download</button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3" style={css('margin-bottom: 12px; font-size: 12px; color: var(--color-neutral-700)')}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1.5"><span style={{ width: 18, height: 3, borderRadius: 2, background: '#c2477a', display: 'inline-block' }} />Signal (mV, relative to resting)</span>
                <span className="flex items-center gap-1.5"><span style={{ width: 18, height: 3, borderRadius: 2, background: '#9c1f56', display: 'inline-block' }} />Signal spike</span>
                <span className="flex items-center gap-1.5"><span style={{ width: 18, height: 0, borderTop: '2px dashed #c2477a', display: 'inline-block' }} />Resting level (0 mV)</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2.5">
                <span className="tag" style={{ borderRadius: 999, background: isSim ? 'var(--color-accent-200)' : 'var(--color-accent-2-200)', color: isSim ? 'var(--color-accent-900)' : 'var(--color-accent-2-900)' }}>{isSim ? 'Simulated data — no plant connected' : 'Live plant — real sensor'}</span>
                <span className="tag tag-neutral" style={css('border-radius: 999px')}>electrode baseline {baseline.toFixed(1)} mV</span>
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
                {samples.length === 0 ? (
                  <div style={css('height: 100%; display: flex; align-items: center; justify-content: center')}><MascotSpinner /></div>
                ) : (
                <svg viewBox="0 0 900 280" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
                  {v.gridLines.map((g) => (
                    <line key={g.value} x1="0" y1={g.y} x2="900" y2={g.y}
                      stroke={g.value === 0 ? '#c2477a' : '#9a9081'}
                      strokeWidth={g.value === 0 ? 2 : 1}
                      strokeDasharray={g.value === 0 ? '7 7' : undefined}
                      opacity={g.value === 0 ? 0.85 : 0.18} />
                  ))}
                  <path d={v.areaPath} fill="color-mix(in srgb, #c2477a 18%, transparent)" />
                  <path d={v.linePath} fill="none" stroke="#c2477a" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                  <path d={v.spikePath} fill="none" stroke="#9c1f56" strokeWidth="3" strokeLinejoin="round" />
                </svg>
                )}
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
                <h2 className="card-title" style={css('margin: 0; font-size: 22px')}><FadeWords text="Status over time" /></h2>
                <p className="card-body" style={css('margin: 4px 0 0; font-size: 14px')}><FadeWords delayOffset={40} text={'An hour-by-hour view of the last two days for ' + device + '. Each block is one hour.'} /></p>
              </div>
              <div className="flex items-center gap-3" style={css('font-size: 12px; color: var(--color-neutral-700)')}>
                <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--color-accent-2-600)', display: 'inline-block' }} />Reporting</span>
                <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--color-accent-600)', display: 'inline-block' }} />Signal detected</span>
                <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--color-neutral-400)', display: 'inline-block' }} />No data</span>
              </div>
            </div>
            <div style={css('display: flex; gap: 2px; align-items: flex-end; overflow-x: auto')}>
              {statusHours.map((h) => {
                const state = h.batches === 0 ? 'offline' : h.events > 0 ? 'event' : 'reporting';
                const bg = state === 'offline' ? 'var(--color-neutral-400)'
                  : state === 'event' ? 'var(--color-accent-600)' : 'var(--color-accent-2-600)';
                const label = fmtHour(h.hour_start) + ' — ' + h.batches + ' batch' + (h.batches === 1 ? '' : 'es')
                  + (h.events ? ', ' + h.events + ' signal' + (h.events === 1 ? '' : 's') : '');
                return (
                  <span
                    key={h.hour_start}
                    title={label}
                    style={{ flex: '1 0 5px', minWidth: 5, height: 40, borderRadius: 2, background: bg }}
                  />
                );
              })}
              {!statusHours.length && (
                <p className="card-body" style={css('margin: 0; font-size: 14px; color: var(--color-neutral-600)')}>No history yet for this router.</p>
              )}
            </div>
          </div>

          <div className="card elev-md" style={css('grid-column: 1 / -1; border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 18px')}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="card-title" style={css('margin: 0; font-size: 22px')}><FadeWords text="The site" /></h2>
                <p className="card-body" style={css('margin: 4px 0 0; font-size: 14px; max-width: 62ch')}><FadeWords delayOffset={40} text="A schematic diagram of every real router on the network and how active each one is right now — positions here are just layout, not GPS/site placement (no location data exists for them yet). The blue glow shows how wet the soil is, averaged across every reporting probe." /></p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="tag tag-outline" style={css('border-radius: 999px; color: #14395e; border-color: #14395e')}>Range: {soilStats ? soilStats.min.toFixed(0) + '–' + soilStats.max.toFixed(0) + ' mV (raw)' : '—'}</span>
                <span className="tag tag-outline" style={css('border-radius: 999px; color: #14395e; border-color: #14395e')}>Average: {soilStats ? soilStats.avgMv.toFixed(0) + ' mV (raw)' : '—'}</span>
              </div>
            </div>
            {graph.nodes.length ? (
              <>
                <div style={css('display: flex; gap: 16px; align-items: stretch')}>
                  <div style={css('flex: none; width: 32px; position: relative')}>
                    <div style={css('position: absolute; inset: 0; border-radius: 999px; background: var(--color-neutral-300); overflow: hidden')}>
                      {tempFrac != null && (
                        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: (tempFrac * 100) + '%', background: 'linear-gradient(to top, #e0559c 0%, #9b4fd1 35%, #ff8a3d 70%, #e2412f 100%)' }} />
                      )}
                    </div>
                    {tempFrac != null && (
                      <span style={{ position: 'absolute', left: '100%', bottom: (tempFrac * 100) + '%', transform: 'translate(8px, 50%)', zIndex: 5, whiteSpace: 'nowrap', padding: '4px 10px', borderRadius: 'var(--radius-lg)', background: 'var(--color-neutral-900)', color: 'var(--color-neutral-100)', fontSize: 13, fontWeight: 600, boxShadow: 'var(--shadow-md)', pointerEvents: 'none' }}>
                        {Math.round(tempF)}°F
                      </span>
                    )}
                  </div>
                  <div style={css('flex: 1; min-width: 0; position: relative; border-radius: var(--radius-lg); background: var(--color-neutral-200)')}>
                  <svg viewBox="0 0 600 300" style={{ width: '100%', height: 'auto', display: 'block' }}>
                    <rect x="0" y="0" width="600" height="300" fill="#e7dcc7" />
                    <defs>
                      <radialGradient id="moistureGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#2f6fa8" stopOpacity="0.65" />
                        <stop offset="100%" stopColor="#2f6fa8" stopOpacity="0" />
                      </radialGradient>
                    </defs>
                    {soilStats?.avgWetFrac != null && (
                      <circle cx={graph.moistureCenter.x} cy={graph.moistureCenter.y} r={20 + soilStats.avgWetFrac * 210} fill="url(#moistureGlow)" />
                    )}
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
            <div className="flex items-center justify-between gap-3">
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}><FadeWords text="Router activity" /></h2>
              <span className="tag tag-neutral" style={css('border-radius: 999px')}>{network.nodes.length} reporting</span>
            </div>
            <p className="card-body" style={css('margin: 0; font-size: 14px')}><FadeWords delayOffset={40} text="Each router's current electrical activity, in millivolts. A flat bar means a router has dropped off the network." /></p>
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

          <div className="card elev-sm" style={css('border-radius: var(--radius-lg); padding: 26px; display: flex; flex-direction: column; gap: 16px')}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}><FadeWords text="Router connection" /></h2>
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
              <h2 className="card-title" style={css('margin: 0; font-size: 22px')}><FadeWords text="Data completeness" /></h2>
              <span className="tag" style={{ borderRadius: 999, background: gapBg, color: gapFg }}>{v.dropped ? v.seqs.length + ' of ' + (v.seqs.length + v.dropped) + ' arrived' : 'all arrived'}</span>
            </div>
            <p className="card-body" style={css('margin: 0; font-size: 14px')}><FadeWords delayOffset={40} text="Each bar is a batch of readings. Orange bars mark readings that never arrived, so a quiet patch in the chart is never mistaken for a quiet plant." /></p>
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

      </main>
      <Mascot />
    </div>
    <Footer />
    </>
  );
}
