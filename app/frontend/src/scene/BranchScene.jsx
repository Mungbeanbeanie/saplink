import React from 'react';
import { apiFetch } from '../lib/api.js';

class BranchScene extends React.Component {
  state = { sent: false, health: null, healthErr: false, signedIn: false, mounted: false };

  readAuth() {
    try { return localStorage.getItem('saplink.signedIn') === '1'; } catch (e) { return false; }
  }

  rng(seed) { let x = seed; return () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296; }

  // A centreline that curves gently and irregularly — no straight runs, no fixed angles.
  spine(rand, x0, y0, a0, len, bend, maxTilt) {
    const segs = 24, step = len / segs, pts = [[x0, y0, 0, a0]];
    let x = x0, y = y0, a = a0;
    for (let i = 1; i <= segs; i++) {
      a += bend / segs + (rand() - 0.5) * 0.06;
      if (maxTilt) a = Math.max(-maxTilt, Math.min(maxTilt, a));
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      pts.push([x, y, i / segs, a]);
    }
    return pts;
  }

  // One continuous tapered outline around a centreline: a single closed path, no joints or gaps.
  ribbon(pts, w0, w1, pow) {
    const L = [], R = [];
    for (const [x, y, t, a] of pts) {
      const w = (w0 + (w1 - w0) * Math.pow(t, pow)) / 2;
      const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
      L.push(`${(x + nx).toFixed(1)} ${(y + ny).toFixed(1)}`);
      R.push(`${(x - nx).toFixed(1)} ${(y - ny).toFixed(1)}`);
    }
    return 'M' + L.join('L') + 'L' + R.reverse().join('L') + 'Z';
  }

  // Grow a limb and its offshoots. Children start exactly on the parent's centreline
  // at the parent's local width, so every junction is continuous.
  grow(rand, cfg, out, x0, y0, ang, len, w, depth, inherit) {
    const bend = (rand() < 0.5 ? -1 : 1) * cfg.bendScale * (0.55 + rand() * 0.95);
    const pts = this.spine(rand, x0, y0, ang, len, bend, cfg.maxTilt);
    const pow = cfg.taperPow * (0.85 + rand() * 0.35);
    const wTip = Math.max(1.7, w * (0.16 + rand() * 0.12));
    out.paths.push(this.ribbon(pts, w, wTip, pow));

    // node spacing wanders, and the side a leaf takes is only loosely alternating
    let i = 2 + Math.floor(rand() * 2);
    let side = inherit || (rand() < 0.5 ? 1 : -1);
    let n = 0;
    while (i < pts.length - 1) {
      const [px, py, t, pa] = pts[i];
      const wHere = w + (wTip - w) * Math.pow(t, pow);
      side = rand() < 0.82 ? -side : side;
      n++;
      out.leaves.push({
        x: px, y: py,
        // orientation follows the branch: a modest sweep off the local tangent, angled toward the tip
        ang: (pa + side * (cfg.leafSweep * (0.8 + rand() * 0.5))) * 57.2958,
        size: cfg.leafSize * (0.6 + rand() * 0.55) * (1 - t * 0.28), seed: rand()
      });
      if (depth < 2 && n % (depth ? 3 : 2) === 1 && t > 0.16 && t < 0.8 && wHere > 3.4) {
        const childAng = pa + side * (0.3 + rand() * 0.34);
        this.grow(rand, cfg, out, px, py,
          cfg.maxTilt ? Math.max(-cfg.maxTilt, Math.min(cfg.maxTilt, childAng)) : childAng,
          len * (0.34 + rand() * 0.26), Math.max(2.6, wHere * (0.6 + rand() * 0.22)), depth + 1, -side);
      }
      i += cfg.nodeEvery + (rand() < 0.4 ? 1 : 0) + (depth ? 1 : 0);
    }

    const tip = pts[pts.length - 1];
    out.leaves.push({ x: tip[0], y: tip[1], ang: (tip[3] + (rand() - 0.5) * 0.26) * 57.2958,
      size: cfg.leafSize * (0.5 + rand() * 0.24), seed: rand() });
  }

  // A leaf at a growth node: visible petiole off the branch, blade beyond it, veins clipped inside.
  leaf(cfg, key, lf) {
    const blade = lf.size;
    const h = blade * 0.46;
    const pet = Math.max(7, blade * 0.3);
    const vein = `color-mix(in srgb, ${cfg.leafColor} 50%, #272e1b)`;
    return React.createElement('div', { key: key, style: {
      position: 'absolute', left: lf.x, top: lf.y, width: 0, height: 0, zIndex: 6,
      transformOrigin: '0% 50%', transform: `rotate(${lf.ang}deg)`
    } }, [
      React.createElement('div', { key: 'p', style: {
        position: 'absolute', left: 0, top: -0.75, width: pet, height: Math.max(1.4, blade * 0.05),
        borderRadius: 999, background: cfg.bark
      } }),
      React.createElement('div', { key: 'w', style: {
        position: 'absolute', left: pet - 1, top: 0, transformOrigin: '0% 50%',
        animation: `flutter ${(2.6 + lf.seed * 2.4) / cfg.speed}s ease-in-out ${lf.seed * 3}s infinite`
      } }, React.createElement('div', {
        className: cfg.drips ? 'sl-tip' : null,
        style: {
          position: 'relative', overflow: 'hidden', width: blade, height: h,
          transform: 'translateY(-50%)',
          // lens shape: a point at the petiole joint (0, h/2) and a point at the far tip (w, h/2)
          clipPath: `path("M0 ${(h / 2).toFixed(1)} C ${(blade * 0.26).toFixed(1)} ${(-h * 0.06).toFixed(1)}, ${(blade * 0.7).toFixed(1)} ${(h * 0.04).toFixed(1)}, ${blade.toFixed(1)} ${(h / 2).toFixed(1)} C ${(blade * 0.68).toFixed(1)} ${(h * 0.99).toFixed(1)}, ${(blade * 0.3).toFixed(1)} ${(h * 1.04).toFixed(1)}, 0 ${(h / 2).toFixed(1)} Z")`,
          background: `linear-gradient(115deg, ${cfg.leafColor}, color-mix(in srgb, ${cfg.leafColor} 66%, #f0fae1))`
        }
      }, [
        React.createElement('div', { key: 'm', style: {
          position: 'absolute', left: 0, top: '50%', width: '100%', height: 1,
          background: vein, opacity: 0.45
        } }),
        React.createElement('div', { key: 'v1', style: {
          position: 'absolute', left: '26%', top: '50%', width: blade * 0.2, height: 1, background: vein,
          opacity: 0.28, transformOrigin: '0% 50%', transform: 'rotate(24deg)'
        } }),
        React.createElement('div', { key: 'v2', style: {
          position: 'absolute', left: '40%', top: '50%', width: blade * 0.19, height: 1, background: vein,
          opacity: 0.28, transformOrigin: '0% 50%', transform: 'rotate(-22deg)'
        } }),
        React.createElement('div', { key: 'v3', style: {
          position: 'absolute', left: '56%', top: '50%', width: blade * 0.14, height: 1, background: vein,
          opacity: 0.24, transformOrigin: '0% 50%', transform: 'rotate(20deg)'
        } })
      ]))
    ]);
  }

  branch(cfg0) {
    const cfg = Object.assign({ bendScale: 0.28, taperPow: 0.8, nodeEvery: 2, leafSweep: 0.5 }, cfg0);
    const rand = this.rng(cfg.seed);
    const out = { paths: [], leaves: [] };
    this.grow(rand, cfg, out, 0, 0, 0, cfg.len, cfg.thick, 0);
    const svg = React.createElement('svg', { key: 'svg', style: {
      position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', zIndex: 1
    } }, out.paths.map((d, i) => React.createElement('path', { key: i, d: d, fill: cfg.bark })));
    // Bark and foliage are emitted as two identically-transformed trees so the page can
    // stack every leaf above every branch — they share one sway timing and stay in phase.
    const frame = (key, kids) => React.createElement('div', { key: key, style: Object.assign({
      position: 'absolute', transformOrigin: '0% 50%', transform: `rotate(${cfg.angle}deg)`
    }, cfg.at) }, React.createElement('div', { style: {
      position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformOrigin: '0% 50%',
      '--sw': cfg.sway, animation: `sway ${5.5 / cfg.speed}s ease-in-out infinite alternate`
    } }, kids));
    return {
      bark: frame('bark' + cfg.seed, svg),
      foliage: frame('leaf' + cfg.seed, out.leaves.map((lf, i) => this.leaf(cfg, 'lf' + i, lf)))
    };
  }

  layer(ref, z, blur, children, extra) {
    return React.createElement('div', { key: z, ref: ref, style: Object.assign({
      position: 'absolute', inset: 0, willChange: 'transform', filter: blur ? `blur(${blur}px)` : 'none'
    }, extra || {}) }, children);
  }

  componentDidMount() {
    // The scroll listener only records where the page actually is; a
    // separate rAF loop eases the rendered position toward that target each
    // frame instead of snapping the transform straight to it inside the
    // scroll event. Scroll events fire at whatever cadence the input device
    // gives (bursty on a notchy wheel, front-loaded on momentum scroll), so
    // writing the transform there directly reads as the branches jumping in
    // steps; easing toward the target every animation frame is what makes
    // the parallax read as one continuous, smooth motion regardless of how
    // choppy the underlying scroll events are.
    this.scrollTarget = window.scrollY || document.documentElement.scrollTop || 0;
    this.scrollCurrent = this.scrollTarget;
    this.onScroll = () => {
      this.scrollTarget = window.scrollY || document.documentElement.scrollTop || 0;
    };
    window.addEventListener('scroll', this.onScroll, { passive: true });

    const tick = () => {
      const dy = this.scrollTarget - this.scrollCurrent;
      this.scrollCurrent += Math.abs(dy) < 0.05 ? dy : dy * 0.12;
      (this.refsList || []).forEach(([r, rate]) => {
        if (r.current) r.current.style.transform = `translate3d(0, ${(-this.scrollCurrent * rate).toFixed(2)}px, 0)`;
      });
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
    this.seedDrops();

    // Fade the scene in once mounted rather than popping in at full opacity
    // the instant the procedurally-built paths exist -- double rAF so the
    // initial opacity:0 is actually painted a frame before the transition
    // to 1 starts, or some browsers collapse the two into one paint and skip
    // the transition entirely.
    requestAnimationFrame(() => requestAnimationFrame(() => this.setState({ mounted: true })));
  }
  componentDidUpdate() { this.seedDrops(); }
  componentWillUnmount() {
    window.removeEventListener('scroll', this.onScroll);
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  pollHealth() {
    apiFetch('/api/health').then((r) => (r.ok ? r.json() : Promise.reject())).then(
      (h) => this.setState({ health: h, healthErr: false }),
      () => this.setState({ healthErr: true })
    );
  }

  // Droplets live in an unrotated overlay so they always fall straight down,
  // seeded from the measured tips of real leaves and branch ends.
  seedDrops() {
    const host = this._drops && this._drops.current;
    const layer = this._r4 && this._r4.current;
    if (!host || !layer) return;
    const sig = [this.props.showDrips, this.props.dripInterval, this.props.branchLayout,
      layer.clientWidth, layer.clientHeight].join('|');
    if (sig === this._dropSig) return;
    this._dropSig = sig;
    host.textContent = '';
    if (!(this.props.showDrips ?? false)) return;
    const every = this.props.dripInterval ?? 7;
    const box = layer.getBoundingClientRect();
    const all = Array.from(layer.querySelectorAll('.sl-tip')).map((el) => [el, el.getBoundingClientRect()]);
    const tips = all.filter(([, r]) => r.top - box.top > 40 && r.bottom - box.top < box.height * 0.8
      && r.left - box.left > 8 && r.right - box.left < box.width - 8);
    if (!tips.length) return;
    const step = Math.max(1, Math.floor(tips.length / 5));
    const rand = this.rng(97);
    tips.filter((_, i) => i % step === 0).slice(0, 5).forEach(([tip, r], i) => {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;left:${r.left - box.left + r.width * 0.5}px;top:${r.top - box.top + r.height - 1}px;` +
        'width:7px;height:9px;border-radius:50% 50% 60% 60% / 40% 40% 100% 100%;' +
        'background:linear-gradient(180deg, rgba(255,255,255,.96), rgba(188,210,204,.92));' +
        'box-shadow:0 0 5px rgba(255,255,255,.75);transform-origin:50% 0%;' +
        `animation:drip ${every * (2.2 + rand() * 1.6)}s cubic-bezier(.45,0,.9,.4) ${i * every * 0.8 + rand() * every}s infinite`;
      host.appendChild(d);
    });
  }

  build() {
    const p = this.props;
    const wind = p.windStrength ?? 1;
    const depth = p.parallaxDepth ?? 1;
    const speed = p.motionSpeed ?? 1;
    const drips = p.showDrips ?? false;
    const dripEvery = p.dripInterval ?? 4;
    const layout = p.branchLayout ?? 'Overhead canopy';

    const L = {
      'Overhead canopy': {
        near: { at: { right: '-6%', top: '22%' }, angle: 194, len: 700 },
        mid: { at: { right: '-4%', top: '50%' }, angle: 172, len: 580 },
        far: { at: { right: '-6%', top: '12%' }, angle: 200, len: 520 },
        side: { at: { right: '-5%', top: '36%' }, angle: 186, len: 700 }
      },
      'Left arch': {
        near: { at: { left: '-6%', top: '16%' }, angle: 14, len: 660 },
        mid: { at: { left: '-4%', top: '58%' }, angle: -12, len: 560 },
        far: { at: { right: '-6%', top: '30%' }, angle: 188, len: 500 },
        side: { at: { left: '-5%', top: '38%' }, angle: 6, len: 700 }
      },
      'Corner diagonal': {
        near: { at: { right: '-6%', top: '4%' }, angle: 208, len: 780 },
        mid: { at: { left: '-5%', top: '62%' }, angle: -16, len: 600 },
        far: { at: { right: '-6%', top: '40%' }, angle: 178, len: 480 },
        side: { at: { left: '-5%', top: '34%' }, angle: -6, len: 800 }
      }
    }[layout];

    if (!this._r1) {
      this._r1 = React.createRef();
      this._r2b = React.createRef(); this._r3b = React.createRef(); this._r4b = React.createRef();
      this._r2 = React.createRef(); this._r3 = React.createRef(); this._r4 = React.createRef();
      this._drops = React.createRef();
    }
    const rFar = 0.18 * depth, rMid = 0.42 * depth, rNear = 1.18 * depth;
    this.refsList = [[this._r1, 0.06 * depth],
      [this._r2b, rFar], [this._r3b, rMid], [this._r4b, rNear],
      [this._r2, rFar], [this._r3, rMid], [this._r4, rNear]];

    const sky = [
      React.createElement('div', { key: 'sky', style: { position: 'absolute', inset: '-20% 0 0 0',
        background: 'linear-gradient(175deg, #fff2eb 0%, #f5ead8 46%, #f0fae1 100%)' } }),
      React.createElement('div', { key: 'sun', style: { position: 'absolute', right: '12%', top: '8%',
        width: 260, height: 260, borderRadius: 999, background: 'radial-gradient(circle, #ffe1d0 0%, rgba(255,225,208,0) 70%)' } }),
      React.createElement('div', { key: 'c1', style: { position: 'absolute', left: '-6%', top: '52%',
        width: 520, height: 300, borderRadius: 999, background: '#e1eecc', filter: 'blur(36px)' } }),
      React.createElement('div', { key: 'c2', style: { position: 'absolute', right: '4%', top: '62%',
        width: 620, height: 260, borderRadius: 999, background: '#ccdbb2', filter: 'blur(44px)', opacity: 0.8 } })
    ];

    const base = { speed: speed, drips: false, dripEvery: dripEvery };
    const far = this.branch(Object.assign({}, base, L.far, { seed: 7, thick: 9, leafSize: 25,
      bark: '#a19786', leafColor: '#aebf92', sway: 0.9 * wind,
      bendScale: 0.42, taperPow: 0.62, nodeEvery: 3, leafSweep: 0.58 }));
    const mid = this.branch(Object.assign({}, base, L.mid, { seed: 113, thick: 17, leafSize: 37,
      bark: '#8c491a', leafColor: '#728157', sway: 1.3 * wind,
      bendScale: 0.22, taperPow: 0.95, nodeEvery: 2, leafSweep: 0.44 }));
    const sideB = this.branch(Object.assign({}, base, L.side, { seed: 211, thick: 21, leafSize: 44,
      bark: '#645c50', leafColor: '#8fa073', sway: 1.1 * wind, maxTilt: 0.5,
      bendScale: 0.52, taperPow: 1.15, nodeEvery: 3, leafSweep: 0.34 }));
    const near = this.branch(Object.assign({}, base, L.near, { seed: 58, thick: 28, leafSize: 54,
      bark: '#643312', leafColor: '#56633f', sway: 1.8 * wind, drips: drips,
      bendScale: 0.33, taperPow: 0.72, nodeEvery: 2, leafSweep: 0.5 }));

    // every branch's bark goes down first, then every leaf on top: no bark can cross a leaf
    const scene = React.createElement('div', {
      // Wraps the whole scene in one element so mount can fade it in as a
      // single fade (a bare Fragment has no box of its own to transition).
      style: { position: 'absolute', inset: 0, opacity: this.state.mounted ? 1 : 0, transition: 'opacity 900ms ease' }
    }, [
      this.layer(this._r1, 1, 0, sky),
      this.layer(this._r2b, 2, 2.5, far.bark, { opacity: 0.85 }),
      this.layer(this._r3b, 3, 1, [mid.bark, sideB.bark]),
      this.layer(this._r4b, 4, 0, near.bark),
      this.layer(this._r2, 5, 2.5, far.foliage, { opacity: 0.85 }),
      this.layer(this._r3, 6, 1, [mid.foliage, sideB.foliage]),
      this.layer(this._r4, 7, 0, [near.foliage, React.createElement('div', { key: 'drops', ref: this._drops,
        style: { position: 'absolute', inset: 0, zIndex: 9 } })])
    ]);

    return scene;
  }

  render() { return this.build(); }
}

export default BranchScene;
