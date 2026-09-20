import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Procedurally builds a growing branch/flower scene: a seeded PRNG grows six
// limbs out from a center hub, recursively branching (up to depth 5) with a
// chance to bloom into a flower instead of continuing. Each branch/node/
// flower carries the timestamp (in seconds, from scene start) it should
// appear at, computed from branch length / SPEED -- so playback in
// GrowthScene below just walks that timeline. Ported from the supplied
// Saplink Loading.dc.html design; deterministic (fixed seed) so growth reads
// the same shape every time.
function buildGeometry() {
  let s = 90210;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const CX = 800, CY = 500, R0 = 76;
  const branches = [], nodes = [], flowers = [];
  const SAGE = '#8FA576';
  const depthColor = (d) => ['#4B5F38', '#5C6E44', '#6E7F50', SAGE, '#9DB187', '#A8BA92', '#B4C4A0'][Math.min(d, 6)];
  const SPEED = 430; // viewBox units per second

  const inBounds = (x, y) => x > -420 && x < 2020 && y > -420 && y < 1420;

  const grow = (x, y, a, len, depth, t0) => {
    const bend = (rnd() - 0.5) * 0.85;
    const a2 = a + bend;
    const ex = x + Math.cos(a2) * len, ey = y + Math.sin(a2) * len;
    const c1x = x + Math.cos(a) * len * 0.45, c1y = y + Math.sin(a) * len * 0.45;
    const c2x = ex - Math.cos(a2) * len * 0.38, c2y = ey - Math.sin(a2) * len * 0.38;
    const dur = len / SPEED;
    branches.push({
      d: `M ${x.toFixed(1)} ${y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`,
      color: depthColor(depth),
      w: Math.max(1.6, 9 - depth * 1.45),
      t0, t1: t0 + dur
    });
    const t1 = t0 + dur;
    const nr = Math.max(3, 11 - depth * 2.2);
    const bloom = (bx, by, t, scale) => {
      const n = 5, rot = rnd() * 72, pr = (11 + rnd() * 5) * scale, ring = pr * 1.15;
      flowers.push({
        x: bx, y: by, t: t + 0.12, rot,
        petals: Array.from({ length: n }, (_, k) => {
          const pa = (rot + k * (360 / n)) * Math.PI / 180;
          return { dx: +(Math.cos(pa) * ring).toFixed(2), dy: +(Math.sin(pa) * ring).toFixed(2), r: +pr.toFixed(2) };
        }),
        cr: +(pr * 0.6).toFixed(2)
      });
    };
    if (depth < 5) {
      if (depth >= 2 && rnd() < 0.3) bloom(ex, ey, t1, Math.max(0.75, 1.25 - depth * 0.1));
      else nodes.push({ x: ex, y: ey, r: nr, color: depth <= 1 ? SAGE : '#A8BA92', t: t1 });
    }
    if (depth >= 5 || !inBounds(ex, ey)) {
      if (depth >= 2 && inBounds(ex, ey) && rnd() < 0.55) {
        bloom(ex, ey, t1, 1);
      } else {
        nodes.push({ x: ex, y: ey, r: Math.max(2.6, nr * 0.8), color: '#A8BA92', t: t1 });
      }
      return;
    }
    const kids = depth === 0 ? 2 : rnd() < 0.55 ? 2 : 1;
    for (let k = 0; k < kids; k++) {
      const spread = 0.45 + rnd() * 0.45;
      const dir = kids === 1 ? (rnd() - 0.5) * 0.8 : (k === 0 ? -spread : spread);
      grow(ex, ey, a2 + dir, len * (0.78 + rnd() * 0.16), depth + 1, t1 - dur * 0.32);
    }
  };

  for (let i = 0; i < 6; i++) {
    const a = (-90 + i * 60) * Math.PI / 180;
    const sx = CX + Math.cos(a) * R0, sy = CY + Math.sin(a) * R0;
    branches.push({
      d: `M ${CX} ${CY} L ${sx.toFixed(1)} ${sy.toFixed(1)}`,
      color: '#4B5F38', w: 9, t0: 0, t1: 0.22
    });
    nodes.push({ x: sx, y: sy, r: 15, color: '#8FA576', t: 0.22 });
    grow(sx, sy, a, 230, 0, 0.2);
  }
  const grownAt = flowers.reduce((m, f) => Math.max(m, f.t + 0.6), branches.reduce((m, b) => Math.max(m, b.t1), 0));
  return { branches, nodes, flowers, grownAt };
}

// Plays the growth once (not looping -- the .dc.html source loops forever as
// an ambient design preview; here it's a one-shot intro, and IntroLoader
// below hands off to the site once `onGrown` fires) via direct DOM/attribute
// mutation over rAF, same imperative-refs approach BranchScene.jsx already
// uses for its own procedural scene, rather than a state update per frame.
class GrowthScene extends React.Component {
  constructor(props) {
    super(props);
    this.svgRef = React.createRef();
    this.camRef = React.createRef();
    this.treeRef = React.createRef();
    this.nodeRef = React.createRef();
    this.flowerRef = React.createRef();
    this.geo = buildGeometry();
  }

  scan() {
    if (!this.treeRef.current || !this.nodeRef.current || !this.flowerRef.current) return;
    const paths = Array.from(this.treeRef.current.querySelectorAll('.sl-branch'));
    const circles = Array.from(this.nodeRef.current.querySelectorAll('.sl-node'));
    this.items = paths.map((el, i) => {
      const L = el.getTotalLength();
      el.style.strokeDasharray = L;
      el.style.strokeDashoffset = L;
      return { el, L, ...this.geo.branches[i] };
    });
    this.dots = circles.map((el, i) => ({ el, r: this.geo.nodes[i].r, t: this.geo.nodes[i].t }));
    this.blooms = Array.from(this.flowerRef.current.querySelectorAll('.sl-flower'))
      .map((el, i) => ({ el, t: this.geo.flowers[i].t, x: this.geo.flowers[i].x, y: this.geo.flowers[i].y, ph: i * 0.7 }));
  }

  componentDidMount() {
    this.scan();
    this.t0 = performance.now();
    const smooth = (p) => p * p * (3 - 2 * p); // easeInOutSine-like, no hard starts/stops
    const grow = this.geo.grownAt;
    const finishAt = grow + 0.7; // brief settle on the finished scene before handing off
    let notified = false;

    const tick = (now) => {
      const t = (now - this.t0) / 1000;
      const fade = t < 0.9 ? smooth(t / 0.9) : 1;
      if (this.camRef.current) {
        const z = 1.12 - 0.12 * smooth(Math.min(1, t / grow));
        const sway = Math.sin(t * 0.55) * 6;
        const drift = Math.cos(t * 0.42) * 4;
        this.camRef.current.style.transform =
          `translate(${sway.toFixed(2)}px, ${drift.toFixed(2)}px) scale(${z.toFixed(4)}) rotate(${(Math.sin(t * 0.3) * 0.7).toFixed(3)}deg)`;
        this.camRef.current.style.opacity = fade.toFixed(3);
      }
      for (const b of (this.items || [])) {
        const p = b.t1 === b.t0 ? 1 : (t - b.t0) / (b.t1 - b.t0);
        if (p <= 0) { b.el.style.opacity = 0; b.el.style.strokeDashoffset = b.L; continue; }
        const c = Math.min(1, p);
        b.el.style.opacity = Math.min(1, c * 5).toFixed(2);
        b.el.style.strokeDashoffset = (b.L * (1 - smooth(c))).toFixed(2);
      }
      for (const n of (this.dots || [])) {
        const p = (t - n.t) / 0.6;
        if (p <= 0) { n.el.style.opacity = 0; continue; }
        const c = Math.min(1, p);
        const pop = 1 + 0.28 * Math.sin(Math.PI * smooth(c)) * (1 - c * 0.2);
        n.el.style.opacity = smooth(Math.min(1, c * 1.8)).toFixed(3);
        n.el.setAttribute('r', (n.r * smooth(Math.min(1, c * 1.4)) * pop).toFixed(2));
      }
      for (const f of (this.blooms || [])) {
        const p = (t - f.t) / 0.8;
        if (p <= 0) { f.el.style.opacity = 0; continue; }
        const c = Math.min(1, p);
        const sc = smooth(c) * (1 + 0.22 * Math.sin(Math.PI * smooth(c)));
        const spin = -40 + 40 * smooth(c) + Math.sin(t * 0.8 + f.ph) * 3;
        f.el.style.opacity = smooth(Math.min(1, c * 1.6)).toFixed(3);
        f.el.setAttribute('transform', `translate(${f.x} ${f.y}) rotate(${spin.toFixed(2)}) scale(${sc.toFixed(3)})`);
      }
      if (!notified && t >= finishAt) { notified = true; this.props.onGrown(); }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  componentWillUnmount() { cancelAnimationFrame(this.raf); }

  render() {
    const { branches, nodes, flowers } = this.geo;
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'radial-gradient(120% 90% at 50% 45%, #F7EFE4 0%, #F1E5D6 55%, #E9E3CF 100%)', fontFamily: 'Karla, system-ui, sans-serif' }}>
        <svg ref={this.svgRef} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}>
          <g ref={this.camRef} style={{ transformOrigin: '800px 500px' }}>
            <g ref={this.treeRef} fill="none" strokeLinecap="round">
              {branches.map((b, i) => <path key={i} className="sl-branch" d={b.d} stroke={b.color} strokeWidth={b.w} opacity="0" />)}
            </g>
            <g ref={this.nodeRef}>
              {nodes.map((n, i) => <circle key={i} className="sl-node" cx={n.x} cy={n.y} r={n.r} fill={n.color} opacity="0" />)}
            </g>
            <g ref={this.flowerRef}>
              {flowers.map((f, i) => (
                <g key={i} className="sl-flower" opacity="0">
                  {f.petals.map((p, j) => <circle key={j} cx={p.dx} cy={p.dy} r={p.r} fill="#FBF4E6" stroke="#C9D6B4" strokeWidth="1" />)}
                  <circle cx="0" cy="0" r={f.cr} fill="#8FA576" />
                </g>
              ))}
            </g>
            <g style={{ animation: 'sl-breathe 3.6s ease-in-out infinite', transformOrigin: '800px 500px' }}>
              <circle cx="800" cy="500" r="30" fill="#4B5F38" />
            </g>
          </g>
        </svg>

        <div style={{ position: 'relative', zIndex: 2, minHeight: '100%', display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto', justifyItems: 'center', padding: 'clamp(20px, 5vh, 48px) 24px', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 14, paddingBottom: 26 }}>
            <div style={{ flex: '0 1 200px', minHeight: 0 }} />
            <div style={{ fontFamily: 'Bitter, Georgia, serif', fontWeight: 700, fontSize: 44, letterSpacing: '-0.015em', color: '#1F1D1A', textShadow: '0 2px 18px rgba(244,234,220,0.9)' }}>Saplink</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#5C5449', letterSpacing: '0.01em' }}>
              <span style={{ display: 'flex', gap: 5 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#8FA576', animation: 'sl-dots 1.4s ease-in-out infinite' }} />
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#8FA576', animation: 'sl-dots 1.4s ease-in-out .18s infinite' }} />
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#8FA576', animation: 'sl-dots 1.4s ease-in-out .36s infinite' }} />
              </span>
              <span>Waking the network</span>
            </div>
          </div>
          <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8A8073' }}>A Wi-Fi router for plants</div>
        </div>
      </div>
    );
  }
}

const MAX = 9000; // absolute safety cap (ms) if growth math or rAF ever stalls

// Whether to show the intro at all -- computed synchronously (not in an
// effect) so it's already correct on the very first render, with no tick
// where the real page is visible before the overlay appears. Every fresh
// load/refresh replays it (no "seen this session" flag): this is meant to be
// the first thing shown whenever the site opens, landing page included.
function shouldShowIntro() {
  if (typeof window === 'undefined') return false;
  return !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Plays the growing-branch scene on every full page load, then fades into
// the site. Never plays for people who prefer reduced motion. Skip button
// always works, and a stalled scene just opens the site (MAX timeout).
export default function IntroLoader() {
  const [show, setShow] = useState(shouldShowIntro);
  const [leaving, setLeaving] = useState(false);
  const skipRef = useRef(null);
  const doneRef = useRef(false);
  const finishRef = useRef(() => {});

  // useLayoutEffect (not useEffect) so this lands before the browser paints
  // the first frame -- the scroll lock is in place from that very first
  // paint, not one tick after it.
  useLayoutEffect(() => {
    if (show) document.documentElement.classList.add('is-loading');
  }, []);

  useEffect(() => {
    if (!show) return undefined;

    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      setLeaving(true);
      document.documentElement.classList.remove('is-loading');
      setTimeout(() => setShow(false), 800);
    };
    finishRef.current = finish;

    const skip = skipRef.current;
    if (skip) skip.addEventListener('click', finish);
    const maxTimer = setTimeout(finish, MAX);

    return () => {
      if (skip) skip.removeEventListener('click', finish);
      clearTimeout(maxTimer);
    };
  }, [show]);

  if (!show) return null;

  return (
    <div className={'loader' + (leaving ? ' is-leaving' : '')} role="status" aria-label="Loading Saplink">
      <GrowthScene onGrown={() => finishRef.current()} />
      <button ref={skipRef} type="button" className="btn btn-secondary btn-light loader-skip">
        Skip
      </button>
    </div>
  );
}
