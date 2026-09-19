/* #/  Landing page, including the animated canopy scene behind it. */
(function (S) {
  var SVGNS = 'http://www.w3.org/2000/svg';
  var UNITLESS = { zIndex: 1, opacity: 1 };

  /* ── tiny DOM helper ─────────────────────────────────────────── */
  function css(el, st) {
    for (var k in st) {
      var v = st[k];
      if (k.indexOf('--') === 0) el.style.setProperty(k, String(v));
      else el.style[k] = (typeof v === 'number' && !UNITLESS[k]) ? v + 'px' : v;
    }
  }
  function h(tag, props, kids) {
    var isSvg = tag === 'svg' || tag === 'path';
    var el = isSvg ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
    if (props) {
      if (props.style) css(el, props.style);
      if (props.className) el.setAttribute('class', props.className);
      if (props.attrs) for (var a in props.attrs) el.setAttribute(a, props.attrs[a]);
    }
    (kids || []).forEach(function (k) { el.appendChild(k); });
    return el;
  }

  /* ── procedural branches ─────────────────────────────────────── */
  function rng(seed) { var x = seed; return function () { return (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296; }; }

  // A centreline that curves gently and irregularly: no straight runs, no fixed angles.
  function spine(rand, x0, y0, a0, len, bend, maxTilt) {
    var segs = 24, step = len / segs, pts = [[x0, y0, 0, a0]], x = x0, y = y0, a = a0;
    for (var i = 1; i <= segs; i++) {
      a += bend / segs + (rand() - 0.5) * 0.06;
      if (maxTilt) a = Math.max(-maxTilt, Math.min(maxTilt, a));
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      pts.push([x, y, i / segs, a]);
    }
    return pts;
  }

  // One continuous tapered outline around a centreline: a single closed path, no joints or gaps.
  function ribbon(pts, w0, w1, pow) {
    var L = [], R = [];
    pts.forEach(function (p) {
      var x = p[0], y = p[1], t = p[2], a = p[3];
      var w = (w0 + (w1 - w0) * Math.pow(t, pow)) / 2;
      var nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
      L.push((x + nx).toFixed(1) + ' ' + (y + ny).toFixed(1));
      R.push((x - nx).toFixed(1) + ' ' + (y - ny).toFixed(1));
    });
    return 'M' + L.join('L') + 'L' + R.reverse().join('L') + 'Z';
  }

  // Grow a limb and its offshoots. Children start exactly on the parent's centreline
  // at the parent's local width, so every junction is continuous.
  function grow(rand, cfg, out, x0, y0, ang, len, w, depth, inherit) {
    var bend = (rand() < 0.5 ? -1 : 1) * cfg.bendScale * (0.55 + rand() * 0.95);
    var pts = spine(rand, x0, y0, ang, len, bend, cfg.maxTilt);
    var pow = cfg.taperPow * (0.85 + rand() * 0.35);
    var wTip = Math.max(1.7, w * (0.16 + rand() * 0.12));
    out.paths.push(ribbon(pts, w, wTip, pow));

    var i = 2 + Math.floor(rand() * 2);
    var side = inherit || (rand() < 0.5 ? 1 : -1);
    var n = 0;
    while (i < pts.length - 1) {
      var p = pts[i], px = p[0], py = p[1], t = p[2], pa = p[3];
      var wHere = w + (wTip - w) * Math.pow(t, pow);
      side = rand() < 0.82 ? -side : side;
      n++;
      out.leaves.push({
        x: px, y: py,
        ang: (pa + side * (cfg.leafSweep * (0.8 + rand() * 0.5))) * 57.2958,
        size: cfg.leafSize * (0.6 + rand() * 0.55) * (1 - t * 0.28), seed: rand()
      });
      if (depth < 2 && n % (depth ? 3 : 2) === 1 && t > 0.16 && t < 0.8 && wHere > 3.4) {
        var childAng = pa + side * (0.3 + rand() * 0.34);
        grow(rand, cfg, out, px, py,
          cfg.maxTilt ? Math.max(-cfg.maxTilt, Math.min(cfg.maxTilt, childAng)) : childAng,
          len * (0.34 + rand() * 0.26), Math.max(2.6, wHere * (0.6 + rand() * 0.22)), depth + 1, -side);
      }
      i += cfg.nodeEvery + (rand() < 0.4 ? 1 : 0) + (depth ? 1 : 0);
    }
    var tip = pts[pts.length - 1];
    out.leaves.push({ x: tip[0], y: tip[1], ang: (tip[3] + (rand() - 0.5) * 0.26) * 57.2958,
      size: cfg.leafSize * (0.5 + rand() * 0.24), seed: rand() });
  }

  // A leaf at a growth node: visible petiole off the branch, blade beyond it, veins clipped inside.
  function leaf(cfg, lf) {
    var blade = lf.size, hh = blade * 0.46, pet = Math.max(7, blade * 0.3);
    var vein = 'color-mix(in srgb, ' + cfg.leafColor + ' 50%, #272e1b)';
    var vn = function (left, w, rot, op) {
      return h('div', { style: { position: 'absolute', left: left, top: '50%', width: w, height: 1, background: vein,
        opacity: op, transformOrigin: '0% 50%', transform: 'rotate(' + rot + 'deg)' } });
    };
    var petiole = h('div', { style: { position: 'absolute', left: 0, top: -0.75, width: pet,
      height: Math.max(1.4, blade * 0.05), borderRadius: 999, background: cfg.bark } });
    var f = function (n) { return n.toFixed(1); };
    var bladeEl = h('div', {
      className: cfg.drips ? 'sl-tip' : null,
      style: {
        position: 'relative', overflow: 'hidden', width: blade, height: hh, transform: 'translateY(-50%)',
        // lens shape: a point at the petiole joint (0, h/2) and a point at the far tip (w, h/2)
        clipPath: 'path("M0 ' + f(hh / 2) + ' C ' + f(blade * 0.26) + ' ' + f(-hh * 0.06) + ', ' + f(blade * 0.7) + ' ' + f(hh * 0.04) +
          ', ' + f(blade) + ' ' + f(hh / 2) + ' C ' + f(blade * 0.68) + ' ' + f(hh * 0.99) + ', ' + f(blade * 0.3) + ' ' + f(hh * 1.04) + ', 0 ' + f(hh / 2) + ' Z")',
        background: 'linear-gradient(115deg, ' + cfg.leafColor + ', color-mix(in srgb, ' + cfg.leafColor + ' 66%, #f0fae1))'
      }
    }, [
      h('div', { style: { position: 'absolute', left: 0, top: '50%', width: '100%', height: 1, background: vein, opacity: 0.45 } }),
      vn('26%', blade * 0.2, 24, 0.28), vn('40%', blade * 0.19, -22, 0.28), vn('56%', blade * 0.14, 20, 0.24)
    ]);
    var wrap = h('div', { style: { position: 'absolute', left: pet - 1, top: 0, transformOrigin: '0% 50%',
      animation: 'flutter ' + ((2.6 + lf.seed * 2.4) / cfg.speed) + 's ease-in-out ' + (lf.seed * 3) + 's infinite' } }, [bladeEl]);
    return h('div', { style: { position: 'absolute', left: lf.x, top: lf.y, width: 0, height: 0, zIndex: 6,
      transformOrigin: '0% 50%', transform: 'rotate(' + lf.ang + 'deg)' } }, [petiole, wrap]);
  }

  function branch(cfg0) {
    var cfg = Object.assign({ bendScale: 0.28, taperPow: 0.8, nodeEvery: 2, leafSweep: 0.5 }, cfg0);
    var rand = rng(cfg.seed), out = { paths: [], leaves: [] };
    grow(rand, cfg, out, 0, 0, 0, cfg.len, cfg.thick, 0);
    var svg = h('svg', { style: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', zIndex: 1 } },
      out.paths.map(function (d) { return h('path', { attrs: { d: d, fill: cfg.bark } }); }));
    // Bark and foliage are emitted as two identically-transformed trees so the page can
    // stack every leaf above every branch. They share one sway timing and stay in phase.
    var frame = function (kids) {
      var inner = h('div', { style: { position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformOrigin: '0% 50%',
        '--sw': cfg.sway, animation: 'sway ' + (5.5 / cfg.speed) + 's ease-in-out infinite alternate' } }, kids);
      return h('div', { style: Object.assign({ position: 'absolute', transformOrigin: '0% 50%', transform: 'rotate(' + cfg.angle + 'deg)' }, cfg.at) }, [inner]);
    };
    return { bark: frame([svg]), foliage: frame(out.leaves.map(function (lf) { return leaf(cfg, lf); })) };
  }

  function layer(blur, children, extra) {
    return h('div', { style: Object.assign({ position: 'absolute', inset: 0, willChange: 'transform', filter: blur ? 'blur(' + blur + 'px)' : 'none' }, extra || {}) }, children);
  }

  var LAYOUTS = {
    'Overhead canopy': {
      near: { at: { right: '-6%', top: '22%' }, angle: 194, len: 700 }, mid: { at: { right: '-4%', top: '50%' }, angle: 172, len: 580 },
      far: { at: { right: '-6%', top: '12%' }, angle: 200, len: 520 }, side: { at: { right: '-5%', top: '36%' }, angle: 186, len: 700 }
    },
    'Left arch': {
      near: { at: { left: '-6%', top: '16%' }, angle: 14, len: 660 }, mid: { at: { left: '-4%', top: '58%' }, angle: -12, len: 560 },
      far: { at: { right: '-6%', top: '30%' }, angle: 188, len: 500 }, side: { at: { left: '-5%', top: '38%' }, angle: 6, len: 700 }
    },
    'Corner diagonal': {
      near: { at: { right: '-6%', top: '4%' }, angle: 208, len: 780 }, mid: { at: { left: '-5%', top: '62%' }, angle: -16, len: 600 },
      far: { at: { right: '-6%', top: '40%' }, angle: 178, len: 480 }, side: { at: { left: '-5%', top: '34%' }, angle: -6, len: 800 }
    }
  };

  var scene = null; // { host, onScroll, dropSig, ... }

  function buildScene(host) {
    var p = S.config.scene;
    var wind = p.windStrength, depth = p.parallaxDepth, speed = p.motionSpeed;
    var L = LAYOUTS[p.branchLayout] || LAYOUTS['Overhead canopy'];
    var rFar = 0.18 * depth, rMid = 0.42 * depth, rNear = 1.18 * depth;

    var sky = [
      h('div', { style: { position: 'absolute', inset: '-20% 0 0 0', background: 'linear-gradient(175deg, #fff2eb 0%, #f5ead8 46%, #f0fae1 100%)' } }),
      h('div', { style: { position: 'absolute', right: '12%', top: '8%', width: 260, height: 260, borderRadius: 999, background: 'radial-gradient(circle, #ffe1d0 0%, rgba(255,225,208,0) 70%)' } }),
      h('div', { style: { position: 'absolute', left: '-6%', top: '52%', width: 520, height: 300, borderRadius: 999, background: '#e1eecc', filter: 'blur(36px)' } }),
      h('div', { style: { position: 'absolute', right: '4%', top: '62%', width: 620, height: 260, borderRadius: 999, background: '#ccdbb2', filter: 'blur(44px)', opacity: 0.8 } })
    ];
    var base = { speed: speed, drips: false };
    var far = branch(Object.assign({}, base, L.far, { seed: 7, thick: 9, leafSize: 25, bark: '#a19786', leafColor: '#aebf92', sway: 0.9 * wind, bendScale: 0.42, taperPow: 0.62, nodeEvery: 3, leafSweep: 0.58 }));
    var mid = branch(Object.assign({}, base, L.mid, { seed: 113, thick: 17, leafSize: 37, bark: '#8c491a', leafColor: '#728157', sway: 1.3 * wind, bendScale: 0.22, taperPow: 0.95, nodeEvery: 2, leafSweep: 0.44 }));
    var side = branch(Object.assign({}, base, L.side, { seed: 211, thick: 21, leafSize: 44, bark: '#645c50', leafColor: '#8fa073', sway: 1.1 * wind, maxTilt: 0.5, bendScale: 0.52, taperPow: 1.15, nodeEvery: 3, leafSweep: 0.34 }));
    var near = branch(Object.assign({}, base, L.near, { seed: 58, thick: 28, leafSize: 54, bark: '#643312', leafColor: '#56633f', sway: 1.8 * wind, drips: p.showDrips, bendScale: 0.33, taperPow: 0.72, nodeEvery: 2, leafSweep: 0.5 }));

    // every branch's bark goes down first, then every leaf on top: no bark can cross a leaf
    var dropsHost = h('div', { style: { position: 'absolute', inset: 0, zIndex: 9 } });
    var r1 = layer(0, sky), r2b = layer(2.5, [far.bark], { opacity: 0.85 }), r3b = layer(1, [mid.bark, side.bark]), r4b = layer(0, [near.bark]);
    var r2 = layer(2.5, [far.foliage], { opacity: 0.85 }), r3 = layer(1, [mid.foliage, side.foliage]), r4 = layer(0, [near.foliage, dropsHost]);
    [r1, r2b, r3b, r4b, r2, r3, r4].forEach(function (l) { host.appendChild(l); });

    var rates = [[r1, 0.06 * depth], [r2b, rFar], [r3b, rMid], [r4b, rNear], [r2, rFar], [r3, rMid], [r4, rNear]];
    var onScroll = function () {
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      rates.forEach(function (r) { r[0].style.transform = 'translate3d(0,' + (-y * r[1]) + 'px,0)'; });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    scene = { onScroll: onScroll };
    if (p.showDrips) seedDrops(dropsHost, r4, p);
  }

  // Droplets live in an unrotated overlay so they always fall straight down,
  // seeded from the measured tips of real leaves and branch ends.
  function seedDrops(host, layerEl, p) {
    var every = p.dripInterval, box = layerEl.getBoundingClientRect(), rand = rng(97);
    var tips = Array.prototype.map.call(layerEl.querySelectorAll('.sl-tip'), function (el) { return [el, el.getBoundingClientRect()]; })
      .filter(function (t) { var r = t[1]; return r.top - box.top > 40 && r.bottom - box.top < box.height * 0.8 && r.left - box.left > 8 && r.right - box.left < box.width - 8; });
    if (!tips.length) return;
    var step = Math.max(1, Math.floor(tips.length / 5));
    tips.filter(function (_, i) { return i % step === 0; }).slice(0, 5).forEach(function (t, i) {
      var r = t[1], d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:' + (r.left - box.left + r.width * 0.5) + 'px;top:' + (r.top - box.top + r.height - 1) + 'px;' +
        'width:7px;height:9px;border-radius:50% 50% 60% 60% / 40% 40% 100% 100%;' +
        'background:linear-gradient(180deg, rgba(255,255,255,.96), rgba(188,210,204,.92));' +
        'box-shadow:0 0 5px rgba(255,255,255,.75);transform-origin:50% 0%;' +
        'animation:drip ' + (every * (2.2 + rand() * 1.6)) + 's cubic-bezier(.45,0,.9,.4) ' + (i * every * 0.8 + rand() * every) + 's infinite';
      host.appendChild(d);
    });
  }

  /* ── page ────────────────────────────────────────────────────── */
  var timer = null;

  S.pages.landing = {
    title: 'Overview',
    html: function () {
      return '<div class="scene" id="scene" aria-hidden="true"></div>' +
        '<div class="landing">' +

        '<section id="top" class="hero"><div class="hero-copy"><div class="hero-blur"></div>' +
        '<span class="tag tag-accent-2">A Wi-Fi router for plants</span>' +
        '<h1>Saplink</h1>' +
        '<p class="hero-lead">Saplink is a router for plants. One clips onto a living stem, picks up the electrical signals the plant sends as its conditions change — more water, more light, a wound, a dry spell — and puts them on the network, so nearby plants and you both get the message within seconds.</p>' +
        '<div class="btn-row"><a href="#/dashboard" class="btn btn-primary btn-lg">Open the dashboard</a>' + S.googleButton(true) + '</div>' +
        '<div class="health-pill"><span class="health-state"><span class="dot dot-idle" id="hp-dot"></span><span id="hp-label">Checking system…</span></span>' +
        '<span id="hp-devices">— devices</span><span id="hp-batches">— batches</span><span class="muted" id="hp-seen">last reading unknown</span></div>' +
        '<p class="hero-note">Live from the monitoring system, refreshed every fifteen seconds.</p></div></section>' +

        '<section id="who" class="sec-who"><h2>How two plants connect</h2>' +
        '<p class="lead">Each plant gets its own router. Whatever one plant reports — more water, more light, a wound — is carried across the network and delivered to the next plant in about a second.</p>' +
        '<div class="diagram">' + S.svg.diagram + '</div>' +
        '<div class="steps">' +
        step('tag-step-a', '01', 'One plant sends', 'Its router picks up a change in the plant’s electrical activity — water, light, a wound, anything it responds to.') +
        step('tag-step-b', '02', 'Saplink carries it', 'The signal is passed over Wi-Fi, checked against that plant’s resting level, and logged.') +
        step('tag-step-a', '03', 'The neighbour hears it', 'The neighbouring plant’s router delivers the signal, so it knows what is happening next door.') +
        '</div></section>' +

        '<section id="mission" class="sec-mission"><div class="mission-grid"><div class="mission-copy">' +
        '<span class="tag tag-accent-2">Our mission</span>' +
        '<h2>Keep a cleared stand talking while it grows back.</h2>' +
        '<p>Deforestation takes the largest species first. Those trees are the ones the rest of the stand depends on, and when they go the younger plants around them lose the signals that told them what was coming.</p>' +
        '<p>Saplink puts a router on the plants that remain, so what one of them senses still reaches its neighbours. We are building it for the ground in between: land that has been cleared, replanted, and left to recover.</p>' +
        '</div><div class="mission-art">' + S.svg.mission + '</div></div></section>' +

        '<section id="join" class="sec-join"><div class="join-inner">' +
        '<h2>Put a router on your first plant.</h2>' +
        '<p class="lead">The readings are open to everyone. Sign in with Google to acknowledge signals and send a test signal across the plant network.</p>' +
        '<div class="btn-row"><a href="#/dashboard" class="btn btn-primary btn-lg">Open the dashboard</a><span class="signin-slot signin-slot-lg" id="join-signin"></span></div>' +
        '<form class="join-form" id="join-form"><input class="input" id="join-email" type="email" required placeholder="you@example.com" aria-label="Email address">' +
        '<button type="submit" class="btn btn-primary btn-lg">Request a router</button></form>' +
        '<p class="form-note" id="join-note">No spam. One note when routers ship in your area.</p></div></section>' +

        '<footer class="site-footer"><span class="brand-text">Saplink</span>' +
        '<nav><a href="#/" data-scroll="top">Overview</a><a href="#/how-it-works">How it works</a><a href="#/dashboard">Dashboard</a><a href="#join" data-scroll="join">Contact</a></nav>' +
        '<small>Field trials, not a finished product. © Saplink 2026</small></footer>' +
        '</div>';

      function step(tagCls, n, title, body) {
        return '<div class="step"><span class="tag ' + tagCls + '">' + n + '</span><h3>' + title + '</h3><p>' + body + '</p></div>';
      }
    },

    mount: function (root) {
      buildScene(root.querySelector('#scene'));
      if (!S.auth.get()) {
        S.auth.renderButton(root.querySelector('#hero-signin'), { size: 'large', shape: 'pill' });
        S.auth.renderButton(root.querySelector('#join-signin'), { size: 'large', shape: 'pill' });
      }

      var state = { health: null, err: false };
      var $ = function (id) { return root.querySelector('#' + id); };
      function paint() {
        var hh = state.health, online = !!(hh && hh.ok);
        var ago = hh && hh.last_recv ? Math.max(0, Math.round((Date.now() - hh.last_recv) / 1000)) : null;
        $('hp-dot').className = 'dot ' + (online ? 'dot-ok' : state.err ? 'dot-warn' : 'dot-idle');
        $('hp-label').textContent = online ? 'System online' : state.err ? 'API unreachable' : 'Checking system…';
        $('hp-devices').textContent = hh && hh.devices ? hh.devices.length + (hh.devices.length === 1 ? ' device' : ' devices') : '— devices';
        $('hp-batches').textContent = hh && hh.batches != null ? hh.batches.toLocaleString() + ' batches' : '— batches';
        $('hp-seen').textContent = ago == null ? 'last reading unknown' : 'last reading ' + ago + 's ago';
      }
      function poll() {
        S.api('/api/health').then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(
          function (d) { state.health = d; state.err = false; paint(); },
          function () { state.err = true; paint(); }
        );
      }
      poll();
      timer = setInterval(poll, 15000);

      $('join-form').addEventListener('submit', function (e) {
        e.preventDefault();
        $('join-note').textContent = 'Thanks — we will be in touch about a router.';
      });
    },

    unmount: function () {
      clearInterval(timer);
      if (scene) window.removeEventListener('scroll', scene.onScroll);
      scene = null;
    }
  };
})(window.Saplink);
