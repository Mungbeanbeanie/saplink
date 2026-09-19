/* #/dashboard  Live monitoring. Talks to the backend named in config.js and falls back
   to a simulated feed when it is not reachable. */
(function (S) {
  var roster = S.roster;
  var st, root, tickTimer, healthTimer, lastId = 0, els = {};

  var TONE = { ok: ['var(--color-accent-2-200)', 'var(--color-accent-2-900)', '#56633f'], quiet: ['var(--color-accent-200)', 'var(--color-accent-900)', '#c67139'] };

  function q(id) { return els[id] || (els[id] = root.querySelector('#' + id)); }
  function fmtTime(t) { return t ? new Date(t).toTimeString().slice(0, 8) : '—'; }
  // Merge event lists by timestamp, oldest first.
  function mergeEvents(a, b) {
    var byT = {};
    a.concat(b).forEach(function (e) { byT[e.t] = Object.assign({}, byT[e.t], e); });
    return Object.keys(byT).map(function (k) { return byT[k]; }).sort(function (x, y) { return x.t - y.t; });
  }
  function setState(patch) { Object.assign(st, patch); update(); }

  /* ── static markup ───────────────────────────────────────────── */
  function html() {
    var connected = roster.filter(function (n) { return n.status === 'ok'; }).length;
    var total = roster.length;
    var siteCanopy = roster.reduce(function (s, n) { return s + n.canopy; }, 0) / total;

    var tabs = roster.map(function (n) {
      return '<span class="tip-wrap"><button type="button" class="seg-opt" data-device="' + n.id + '">' + n.id + '</button><span class="tip">' + n.plant + '</span></span>';
    }).join('');

    var blocks = Array.from({ length: 48 }, function (_, i) {
      var missing = i === 9 || i === 10 || i === 31, signal = i === 20 || i === 41;
      var bg = missing ? 'var(--color-neutral-400)' : signal ? 'var(--color-accent-500)' : 'var(--color-accent-2-500)';
      return '<span title="' + (47 - i) + 'h ago — ' + (missing ? 'no data' : signal ? 'signal sent' : 'steady') + '" style="background:' + bg + '"></span>';
    }).join('');

    var patches = roster.map(function (n) {
      var rx = 42 + n.canopy * 1.3;
      return '<ellipse cx="' + n.x + '" cy="' + n.y + '" rx="' + rx.toFixed(0) + '" ry="' + (rx * 0.62).toFixed(0) + '" fill="#7a8a5e" opacity="' + (0.1 + (n.canopy / 100) * 0.62).toFixed(2) + '"></ellipse>';
    }).join('');
    var links = [[0, 1], [1, 2], [1, 4], [2, 3]].map(function (p) {
      return '<line x1="' + roster[p[0]].x + '" y1="' + roster[p[0]].y + '" x2="' + roster[p[1]].x + '" y2="' + roster[p[1]].y + '" stroke="#8c491a" stroke-width="2" stroke-dasharray="6 6" opacity="0.6"></line>';
    }).join('');
    var nodes = roster.map(function (n) {
      var t = TONE[n.status];
      return '<g class="map-node" data-node="' + n.id + '"><circle cx="' + n.x + '" cy="' + n.y + '" r="18" fill="' + t[0] + '" opacity="0.55"></circle>' +
        '<circle cx="' + n.x + '" cy="' + n.y + '" r="15" fill="' + t[0] + '"></circle><circle cx="' + n.x + '" cy="' + n.y + '" r="8" fill="' + t[2] + '"></circle></g>';
    }).join('');
    var mapTips = roster.map(function (n) {
      return '<span class="map-tip" data-tip="' + n.id + '" hidden style="left:' + ((n.x / 600) * 100).toFixed(1) + '%;top:' + ((n.y / 300) * 100).toFixed(1) + '%">' + n.label + ' · ' + n.plant + '</span>';
    }).join('');
    var chips = roster.map(function (n) {
      var t = n.status === 'ok' ? 'tone-ok' : 'tone-warn';
      return '<span class="tip-wrap"><span class="tag ' + t + '">' + n.label + ' · ' + n.canopy + '% canopy · ' + (n.status === 'ok' ? 'reporting' : 'quiet 6h') + '</span><span class="tip">' + n.plant + '</span></span>';
    }).join('');

    var conditions = [['68%', 'Air humidity'], ['41%', 'Soil moisture'], ['14.2°C', 'Air temperature'], ['320 lux', 'Light level']].map(function (c) {
      return '<div class="condition"><b>' + c[0] + '</b><span>' + c[1] + '</span></div>';
    }).join('');

    var traffic = roster.map(function (n, i) {
      var ok = n.status === 'ok';
      return '<div class="traffic-row"><div class="traffic-label"><span class="id mono" title="' + n.plant + '">' + n.id + '</span><span class="rate">' + (ok ? (1.4 - i * 0.2).toFixed(1) + ' kB/min' : 'silent') + '</span></div>' +
        '<div class="bar"><i style="width:' + (ok ? (88 - i * 16) + '%' : '3%') + ';background:' + (ok ? 'var(--color-accent-2-600)' : 'var(--color-accent-600)') + '"></i></div></div>';
    }).join('');

    return '<div class="dash">' +
      '<div class="dash-head"><div><div class="card-kicker kicker">Live monitoring</div><h1>Dashboard</h1>' +
      '<p>Every plant on the network has its own router. Plants change their electrical activity as conditions change — more water, more light, a wound, a dry spell — and when that activity moves clear of the plant’s resting level the router puts it on the network, reaching this page within seconds.</p></div>' +
      '<div class="router-pick"><span class="label">Router</span><div class="seg tabs" id="tabs">' + tabs + '</div></div></div>' +

      '<div class="selected"><span class="plant" id="sel-plant"></span><span class="site" id="sel-site"></span></div>' +

      '<div class="stats">' +
      '<div class="card elev-sm panel stat"><span class="stat-disc tone-ok">' + connected + '/' + total + '</span><div class="stat-main"><div class="stat-head">' + connected + ' of ' + total + ' reporting</div><div class="stat-sub">Plants with a router</div></div></div>' +
      '<div class="card elev-sm panel stat"><span class="dot stat-dot dot-ok" id="ov-dot"></span><div class="stat-main"><div class="stat-head" id="ov-head"></div><div class="stat-sub" id="ov-note"></div></div></div>' +
      '<div class="card elev-sm panel stat"><span class="stat-disc tone-ok" id="cp-disc" style="font-size:17px"></span><div class="stat-main"><div class="stat-head" id="cp-head"></div><div class="stat-sub" id="cp-note"></div></div></div>' +
      '</div>' +

      '<div class="alert" id="alert" hidden><div class="alert-main"><span class="alert-dot"></span><div><div class="alert-title">Signal detected</div>' +
      '<div class="alert-detail" id="al-detail"></div><div class="alert-time" id="al-time"></div></div></div>' +
      '<div class="alert-side"><span class="tag tag-outline" id="al-src"></span><button type="button" id="ack" class="btn btn-primary">Acknowledge</button></div></div>' +

      '<div class="dash-grid">' +

      '<div class="card elev-md panel wide wide-chart"><div class="card-head big"><div><h2 class="card-title" style="font-size:26px;margin:0">Electrical activity</h2>' +
      '<p>The dashed line is the plant\'s normal resting level. The chart stays quiet until the plant responds: a spike marks a signal, in millivolts, whenever conditions around it change — more water, more light, a wound, a dry spell.</p></div>' +
      '<div class="chips"><span class="tag" id="chart-src"></span><span class="tag tag-neutral" id="chart-base"></span><span class="tag tag-neutral" id="chart-cur"></span></div></div>' +
      '<div class="plot"><div class="plot-y" id="y-labels" aria-hidden="true"></div>' +
      '<div class="plot-col"><div class="plot-area"><svg viewBox="0 0 900 280" preserveAspectRatio="none" role="img" aria-label="Signals from this plant over the last 24 hours, in millivolts">' +
      '<g class="grid" stroke="#645c50" stroke-opacity="0.13" stroke-width="1">' +
      [1, 2, 3, 4, 5].map(function (k) { return '<line x1="' + (k * 150) + '" y1="0" x2="' + (k * 150) + '" y2="280" vector-effect="non-scaling-stroke"></line>'; }).join('') +
      '<g id="grid-y"></g></g>' +
      '<line id="base-line" x1="0" y1="0" x2="900" y2="0" stroke="#9a9081" stroke-width="1.5" stroke-dasharray="7 7"></line>' +
      '<g id="peaks"></g></svg><div id="peak-labels"></div><div id="peak-hits"></div>' +
      '<div class="plot-empty" id="plot-empty">No signals in the last 24 hours. The plant is at its resting level.</div></div>' +
      '<div class="plot-ticks" aria-hidden="true">' + ['−24h', '−20h', '−16h', '−12h', '−8h', '−4h'].map(function (l, k) { return '<span style="left:' + (k * 100 / 6).toFixed(3) + '%">' + l + '</span>'; }).join('') + '<span class="last">now</span></div></div></div>' +
      '<div class="plot-count" id="x-count"></div>' +
      '<ul class="signals" id="signal-list"></ul>' +
      '<button type="button" class="signals-toggle" id="signals-toggle" aria-expanded="false" aria-controls="signal-list" hidden><span id="signals-toggle-label">More</span>' +
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"></path></svg></button></div>' +

      '<div class="card elev-sm panel wide"><div class="card-head"><div><h2 class="card-title" style="font-size:22px;margin:0">Status over time</h2>' +
      '<p>Each block is one hour of the last two days. Green means the plants were steady and every router reported in.</p></div>' +
      '<div class="legend"><span><i style="background:var(--color-accent-2-500)"></i>Steady</span><span><i style="background:var(--color-accent-500)"></i>Signal sent</span><span><i style="background:var(--color-neutral-400)"></i>No data</span></div></div>' +
      '<div class="blocks">' + blocks + '</div><div class="axis"><span>48 hours ago</span><span>now</span></div></div>' +

      '<div class="card elev-md panel wide"><div class="card-head end"><div><h2 class="card-title" style="font-size:22px;margin:0">The site</h2>' +
      '<p>Where the routers sit, which ones are linked, and how much of the ground the canopy has taken back.</p></div>' +
      '<div class="site-metrics"><div class="metric sage"><b>' + siteCanopy.toFixed(0) + '%</b><span>canopy cover now</span></div>' +
      '<div class="metric"><b>+' + (siteCanopy - 20.8).toFixed(0) + ' pts</b><span>since replanting began</span></div></div></div>' +
      '<div class="map"><svg viewBox="0 0 600 300" role="img" aria-label="Map of router positions and canopy cover"><rect x="0" y="0" width="600" height="300" fill="#e7dcc7"></rect>' + patches + links + nodes + '</svg>' + mapTips + '</div>' +
      '<div class="chips">' + chips + '</div></div>' +

      '<div class="card elev-sm panel"><div><h2 class="card-title" style="font-size:22px;margin:0">Conditions</h2><p class="desc" style="margin-top:4px">Each router measures these alongside the electrical signal, because weather shapes how a plant reacts.</p></div><div class="conditions">' + conditions + '</div></div>' +

      '<div class="card elev-sm panel"><div class="card-head"><h2 class="card-title" style="font-size:22px;margin:0">Network traffic</h2><span class="tag tag-neutral">' + (connected * 1.2).toFixed(1) + ' kB/min</span></div>' +
      '<p class="desc">How much data each router is sending. A flat bar means a router has dropped off the network.</p><div class="traffic">' + traffic + '</div></div>' +

      '<div class="card elev-sm panel" style="justify-content:space-between"><div class="card-head"><h2 class="card-title" style="font-size:22px;margin:0">Download the data</h2><span class="tag tag-neutral" id="export-count"></span></div>' +
      '<p class="desc">Every signal on record, saved to a spreadsheet or as raw JSON for analysis.</p>' +
      '<div class="btn-row tight"><button type="button" id="csv" class="btn btn-primary btn-md">CSV for spreadsheets</button><button type="button" id="json" class="btn btn-secondary btn-md">JSON</button></div>' +
      '<p class="fine" id="export-note"></p></div>' +

      '<div class="card elev-sm panel"><div class="card-head"><h2 class="card-title" style="font-size:22px;margin:0">Router connection</h2><span class="health-inline"><span class="dot dot-idle" id="hp-dot"></span><span id="hp-label"></span></span></div>' +
      '<div class="kv"><span>Readings received</span><span id="batches"></span><span>Last reading</span><span id="last-recv"></span><span>Routers reporting</span><span id="device-list"></span><span>Checked</span><span class="dim">every 10s</span></div></div>' +

      '<div class="card elev-sm panel"><div class="card-head"><h2 class="card-title" style="font-size:22px;margin:0">Response relay</h2><span class="tag tag-outline">not live yet</span></div>' +
      '<div class="relay bg-idle" id="relay"><span class="dot dot-idle" id="relay-dot"></span><div><b id="relay-state"></b><span id="relay-note"></span></div></div>' +
      '<p class="fine">When a signal is acknowledged, it is relayed to the router on a neighbouring plant. Shown here as a preview until that link is switched on.</p></div>' +

      '<div class="card elev-sm panel"><div class="card-head"><h2 class="card-title" style="font-size:22px;margin:0">Send a test signal</h2><span class="tag tag-outline">sign-in needed</span></div>' +
      '<p class="desc">Replays a recorded signal so you can check the whole chain — router, alert, relay — without waiting for the plant to react.</p>' +
      '<button type="button" id="replay" class="btn btn-primary btn-block btn-lg"></button><p class="fine" id="replay-note"></p></div>' +

      '</div>' + S.copyright() + '</div>';
  }

  /* ── data ────────────────────────────────────────────────────── */
  function pollHealth() {
    S.api('/api/health').then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(
      function (d) { setState({ health: d, healthErr: false, live: true }); },
      function () { setState({ healthErr: true, live: false }); }
    );
  }
  function tick() {
    S.api('/api/readings/history?since_id=' + (lastId || 0)).then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(ingest, mock);
  }
  function ingest(d) {
    var rows = (d && d.readings) || [];
    if (rows.length) lastId = rows[rows.length - 1].id;
    var found = rows.filter(function (r) { return r.event === 'spike'; })
      .map(function (r) { return { t: r.timestamp_ms, mv: r.mv, threshold: r.threshold_mv, base: r.baseline_mv, sim: r.src === 'sim' }; });
    var last = rows[rows.length - 1];
    var patch = {
      live: true,
      baseline: last && last.baseline_mv != null ? last.baseline_mv : st.baseline,
      src: last && last.src ? last.src : st.src,
      seq: st.seq.concat(rows.map(function (r) { return r.seq; })).slice(-180)
    };
    if (found.length) { patch.events = mergeEvents(st.events, found); patch.spike = found[found.length - 1]; S.store.addMany(found); }
    setState(patch);
  }
  // Preview feed so the page reads correctly before /api/readings is wired up. Signals are rare on purpose:
  // the chart only changes when the plant responds to something.
  function mock() {
    var now = Date.now();
    st.tick = (st.tick || 0) + 1;
    var seq = st.seq.length ? st.seq[st.seq.length - 1] + (Math.random() < 0.04 ? 2 : 1) : 900;
    var patch = { live: false, src: 'sim', seq: st.seq.concat([seq]).slice(-180) };
    if (st.tick === 25 || (st.tick > 25 && (st.tick - 25) % 90 === 0)) {
      var ev = { t: now, mv: 82 + Math.random() * 14, threshold: 70, base: st.baseline, sim: true };
      patch.events = mergeEvents(st.events, [ev]);
      patch.spike = ev;
      S.store.addMany([ev]);
    }
    setState(patch);
  }

  /* ── downloads ───────────────────────────────────────────────── */
  function legacySave(name, body, type) {
    var url = URL.createObjectURL(new Blob([body], { type: type }));
    var a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }
  function download(kind) {
    var rows = st.events.slice().sort(function (a, b) { return a.t - b.t; }); // every signal on record, not only the last 24 hours
    if (!rows.length) { setState({ exportNote: 'No signals to save yet.' }); return; }
    var body = kind === 'csv'
      ? 'timestamp_ms,time,device,mv,resting_mv,event,source\n' + rows.map(function (r) {
        return [r.t, new Date(r.t).toISOString(), st.device, r.mv.toFixed(2), r.base != null ? r.base : st.baseline, 'spike', r.sim ? 'simulated' : 'sensor'].join(',');
      }).join('\n')
      : JSON.stringify({ device: st.device, resting_mv: st.baseline, signals: rows }, null, 2);
    var name = 'saplink-' + st.device + '.' + kind, note = rows.length + (rows.length === 1 ? ' signal' : ' signals') + ' saved as ' + kind.toUpperCase() + '.';
    var mime = kind === 'csv' ? 'text/csv' : 'application/json';
    var cap = window.claude && window.claude.use ? window.claude.use('downloads') : Promise.resolve(null);
    cap.then(function (d) {
      if (d) return d.save({ filename: name, data: body }).then(function () { setState({ exportNote: note }); }, function () {});
      legacySave(name, body, mime); setState({ exportNote: note });
    }, function () { legacySave(name, body, mime); setState({ exportNote: note }); });
  }

  /* ── render ──────────────────────────────────────────────────── */
  function update() {
    if (!root) return;
    var now = Date.now(), WIN = 24 * 3600 * 1000;
    var ev = st.events.filter(function (e) { return e.t >= now - WIN; });
    var latest = ev.length ? ev[ev.length - 1] : null;
    var top = ev.length ? Math.max.apply(null, ev.map(function (e) { return e.mv; })) : st.baseline + 30;
    var hi = Math.ceil((Math.max(top, st.baseline) + 14) / 10) * 10, lo = Math.floor((st.baseline - 12) / 10) * 10;
    var W = 900, H = 280;
    var X = function (t) { return Math.min(W - 10, Math.max(10, ((t - (now - WIN)) / WIN) * W)); };
    var Y = function (v) { return H - ((v - lo) / (hi - lo)) * H; };
    var ago = function (t) {
      var m = Math.round((now - t) / 60000);
      return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
    };

    var seqs = st.seq.filter(function (v) { return v != null; });
    var dropped = 0;
    for (var i = 1; i < seqs.length; i++) { var d = seqs[i] - seqs[i - 1]; if (d > 1) dropped += d - 1; }

    var hh = st.health, online = !!(hh && hh.ok);
    var lastRecv = hh && hh.last_recv ? Math.max(0, Math.round((Date.now() - hh.last_recv) / 1000)) + 's ago' : null;
    var spike = st.spike, spikeActive = !!spike && !st.acked;
    var isSim = st.src !== 'ads1115';
    var completeness = seqs.length ? Math.max(0, 100 - (dropped / (seqs.length + dropped)) * 100) : 100;
    var sel = roster.find(function (n) { return n.id === st.device; }) || roster[0];

    q('sel-plant').textContent = sel.plant.split(' · ')[0];
    q('sel-site').textContent = sel.plant.split(' · ')[1];
    root.querySelectorAll('[data-device]').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-device') === st.device); });

    q('ov-dot').className = 'dot stat-dot ' + (dropped > 6 || st.healthErr ? 'dot-warn' : 'dot-ok');
    q('ov-head').textContent = st.healthErr ? 'Needs a look' : spikeActive ? 'New signal waiting' : 'Everything healthy';
    q('ov-note').textContent = st.healthErr ? 'The system is not answering' : spikeActive ? 'One plant has something to report' : 'Every router on the network is reporting';
    q('cp-disc').className = 'stat-disc ' + (dropped ? 'tone-warn' : 'tone-ok');
    q('cp-disc').textContent = completeness.toFixed(0) + '%';
    q('cp-head').textContent = dropped ? dropped + (dropped === 1 ? ' reading missing' : ' readings missing') : 'No readings missing';
    q('cp-note').textContent = 'Of the last ' + (seqs.length || 0) + ' batches sent';

    q('alert').hidden = !spikeActive;
    q('al-detail').textContent = spike ? 'A signal rose clear of this plant’s resting level — ' + spike.mv.toFixed(1) + ' mV, where the alert level is ' + (spike.threshold != null ? spike.threshold : 70).toFixed(1) + ' mV' : '';
    q('al-time').textContent = spike ? fmtTime(spike.t) + '  ·  ' + spike.t : '';
    q('al-src').textContent = st.live ? 'from the sensor' : 'preview state';

    q('chart-src').className = 'tag ' + (isSim ? 'tone-warn' : 'tone-ok');
    q('chart-src').textContent = isSim ? 'Simulated data — no plant connected' : 'Live plant — real sensor';
    q('chart-base').textContent = 'resting level ' + st.baseline.toFixed(1) + ' mV';
    q('chart-cur').textContent = latest ? 'last signal ' + fmtTime(latest.t) + ' · ' + latest.mv.toFixed(1) + ' mV' : 'no signal yet';
    q('base-line').setAttribute('y1', Y(st.baseline).toFixed(1)); q('base-line').setAttribute('y2', Y(st.baseline).toFixed(1));
    var sig = ev.map(function (e) { return e.t; }).join() + '|' + st.baseline + '|' + hi + '|' + Math.floor(now / 60000) + '|' + (q('peak-labels').parentNode.clientWidth || 0);
    if (sig !== st.peakSig) {
      st.peakSig = sig;
      var lines = '', labels = '', steps = Math.round((hi - lo) / 10), every = steps > 12 ? 2 : 1;
      for (var m = lo, n = 0; m <= hi; m += 10, n++) {
        var y = Y(m);
        if (m !== lo && m !== hi) lines += '<line x1="0" y1="' + y.toFixed(1) + '" x2="900" y2="' + y.toFixed(1) + '" vector-effect="non-scaling-stroke"></line>';
        if (n % every === 0 || m === hi) labels += '<span style="top:' + ((y / H) * 100).toFixed(2) + '%">' + m + (m === hi ? ' mV' : '') + '</span>';
      }
      q('grid-y').innerHTML = lines;
      q('y-labels').innerHTML = labels;
      var yb = Y(st.baseline).toFixed(1);
      q('peaks').innerHTML = ev.map(function (e) {
        var x = X(e.t), d = 'M' + (x - 9).toFixed(1) + ' ' + yb + 'L' + x.toFixed(1) + ' ' + Y(e.mv).toFixed(1) + 'L' + (x + 9).toFixed(1) + ' ' + yb;
        return '<path d="' + d + 'Z" fill="color-mix(in srgb, #c67139 26%, transparent)"></path>' +
          '<path d="' + d + '" fill="none" stroke="#c67139" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><title>' + fmtTime(e.t) + ' · ' + e.mv.toFixed(1) + ' mV</title></path>';
      }).join('');
      // Time labels sit above each spike (HTML, so the text is not stretched with the chart). Newest wins when two collide.
      var today = new Date().toDateString(), placed = [];
      var pw = q('peak-labels').parentNode.clientWidth || 900, edge = (56 / pw) * 100;
      q('peak-labels').innerHTML = ev.slice().reverse().map(function (e) {
        var left = Math.min(100 - edge, Math.max(edge, (X(e.t) / W) * 100));
        if (placed.some(function (l) { return Math.abs(l - left) * pw / 100 < 104; })) return '';
        placed.push(left);
        return '<span class="peak-label" style="left:' + left.toFixed(2) + '%;top:calc(' + ((Y(e.mv) / H) * 100).toFixed(2) + '% - 5px)">' +
          '<b>' + (new Date(e.t).toDateString() === today ? '' : 'yest. ') + fmtTime(e.t) + '</b><br>' + e.mv.toFixed(1) + ' mV</span>';
      }).join('');
      q('peak-hits').innerHTML = ev.map(function (e) {
        var pct = Math.min(100 - edge / 2, Math.max(edge / 2, (X(e.t) / W) * 100));
        var top = (Y(e.mv) / H) * 100, h = ((Y(st.baseline) - Y(e.mv)) / H) * 100;
        var d = new Date(e.t), over = e.mv - st.baseline;
        var when = d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return '<span class="peak-hit ' + (pct * pw / 100 > pw / 2 ? 'opens-left' : 'opens-right') + '" tabindex="0" role="img" aria-label="Signal at ' + when + ', ' + e.mv.toFixed(1) + ' millivolts" style="left:' + pct.toFixed(2) + '%;top:' + top.toFixed(2) + '%;height:' + h.toFixed(2) + '%">' +
          '<span class="peak-card"><b>' + when + '</b><span class="row"><i>Signal</i><em>' + e.mv.toFixed(1) + ' mV</em></span>' +
          '<span class="row"><i>Over resting</i><em>+' + over.toFixed(1) + ' mV</em></span>' +
          '<span class="row"><i>Resting level</i><em>' + st.baseline.toFixed(1) + ' mV</em></span>' +
          (e.threshold != null ? '<span class="row"><i>Alert level</i><em>' + e.threshold.toFixed(1) + ' mV</em></span>' : '') +
          '<span class="ago">' + ago(e.t) + '</span></span></span>';
      }).join('');
    }
    q('plot-empty').hidden = ev.length > 0;
    q('x-count').textContent = ev.length + (ev.length === 1 ? ' signal' : ' signals') + ' in the last 24 hours' + (st.live ? '' : ' · preview feed');
    var rows = ev.slice().reverse(), LIMIT = 8;
    var shown = st.showAll ? rows : rows.slice(0, LIMIT);
    q('signal-list').innerHTML = shown.map(function (e) {
      return '<li><span class="mono">' + fmtTime(e.t) + '</span><span>' + ago(e.t) + '</span><span class="mono">' + e.mv.toFixed(1) + ' mV</span>' +
        '<span class="tag tone-warn">+' + (e.mv - st.baseline).toFixed(1) + ' mV over resting</span></li>';
    }).join('');
    var tg = q('signals-toggle');
    tg.hidden = rows.length <= LIMIT;
    tg.classList.toggle('is-open', !!st.showAll);
    tg.setAttribute('aria-expanded', st.showAll ? 'true' : 'false');
    q('signals-toggle-label').textContent = st.showAll ? 'Less' : 'More (' + (rows.length - LIMIT) + ')';

    q('export-count').textContent = st.events.length + (st.events.length === 1 ? ' signal' : ' signals');
    q('export-note').textContent = st.exportNote || 'Downloads every signal on record, not only the last 24 hours.';

    q('hp-dot').className = 'dot ' + (online ? 'dot-ok' : st.healthErr ? 'dot-warn' : 'dot-idle');
    q('hp-label').textContent = online ? 'ok' : st.healthErr ? 'unreachable' : 'checking';
    q('batches').textContent = hh && hh.batches != null ? hh.batches.toLocaleString() : '—';
    q('last-recv').textContent = lastRecv || '—';
    q('device-list').textContent = hh && hh.devices ? hh.devices.join(', ') : roster.map(function (n) { return n.id; }).join(', ');


    q('relay').className = 'relay ' + (st.acked ? 'tone-ok' : 'bg-idle');
    q('relay-dot').className = 'dot ' + (st.acked ? 'dot-ok' : 'dot-idle');
    q('relay-state').textContent = st.acked ? 'Neighbouring plant primed' : 'Standing by';
    q('relay-note').textContent = st.acked ? 'Signal acknowledged and passed on' : 'No unacknowledged signal waiting';

    q('replay').disabled = !st.signedIn;
    q('replay').textContent = st.signedIn ? 'Send test signal' : 'Sign in to send';
    q('replay-note').textContent = st.replayNote || (st.signedIn ? 'Recorded against your Google account.' : 'Anyone can view the readings; sending needs sign-in.');
  }

  S.pages.dashboard = {
    title: 'Dashboard',
    html: html,
    mount: function (el) {
      root = el; els = {}; lastId = 0;
      var now0 = Date.now(), seed = [];
      for (var k = 120; k > 0; k--) seed.push(900 + (120 - k));
      st = { device: 'sense-1', events: [], baseline: 42, src: 'sim', live: false, health: null, healthErr: false,
        spike: null, acked: false, signedIn: S.auth.get(), replayNote: '', seq: seed, exportNote: '', peakSig: '', tick: 0, showAll: false };
      // Earlier signals for the preview feed, so the chart opens with something real to look at.
      // Bring back every signal on record. The first time (nothing stored yet) the preview is seeded with
      // earlier signals, marked as simulated, so the chart has something to show.
      S.store.load().then(function (list) {
        if (!root) return;
        if (!list.length) {
          list = [[23.2, 76.4], [20.1, 84.3], [17.4, 71.9], [14.6, 89.5], [12.6, 88.1], [9.8, 74.2], [7.2, 91.7], [3.4, 72.6], [1.6, 78.9]]
            .map(function (h) { return { t: Math.round(now0 - h[0] * 3600e3), mv: h[1], threshold: 70, base: 42, sim: true }; });
          S.store.addMany(list);
        }
        setState({ events: mergeEvents(list, st.events) });
      });
      root.querySelectorAll('[data-device]').forEach(function (b) {
        b.addEventListener('click', function () { setState({ device: b.getAttribute('data-device') }); });
      });
      root.querySelectorAll('.map-node').forEach(function (g) {
        var tip = root.querySelector('[data-tip="' + g.getAttribute('data-node') + '"]');
        g.addEventListener('mouseenter', function () { tip.hidden = false; });
        g.addEventListener('mouseleave', function () { tip.hidden = true; });
      });
      q('signals-toggle').addEventListener('click', function () { setState({ showAll: !st.showAll }); });
      q('ack').addEventListener('click', function () { setState({ acked: true }); });
      q('csv').addEventListener('click', function () { download('csv'); });
      q('json').addEventListener('click', function () { download('json'); });
      q('replay').addEventListener('click', function () {
        if (!st.signedIn) return;
        setState({ replayNote: 'Sending…' });
        S.api('/api/alerts/manual', { method: 'POST' }).then(
          function () { setState({ replayNote: 'Test signal sent', acked: true }); },
          function () { setState({ replayNote: 'Relay not switched on yet — shown as a preview', acked: true }); }
        );
      });

      update();
      tick(); pollHealth();
      tickTimer = setInterval(tick, 1000);
      healthTimer = setInterval(pollHealth, 10000);
    },
    unmount: function () {
      clearInterval(tickTimer); clearInterval(healthTimer);
      root = null; els = {};
    }
  };
})(window.Saplink);
