/* #/how-it-works */
(function (S) {
  var FLOW = [
    { label: 'Probe', pill: 'pill-sage', dot: 'var(--color-accent-2-600)' },
    { label: 'Saplink router', pill: 'pill-clay', dot: 'var(--color-accent-600)' },
    { label: 'Plant network', pill: 'pill-sand', dot: 'var(--color-neutral-600)' },
    { label: 'Browser', pill: 'pill-sage', dot: 'var(--color-accent-2-600)' }
  ];
  var STEPS = [
    ['01 — Plug in', 'Router on the plant', 'Two small electrodes clip onto the stem and read the plant’s electrical activity, thousandths of a volt at a time. That reading is what the router puts on the network.'],
    ['02 — Join', 'On the network', 'The router runs on a battery and joins your Wi-Fi like any other device. Readings go out in numbered batches, so anything lost on the way shows up as a gap rather than passing unnoticed.'],
    ['03 — Relay', 'Passed between plants', 'A signal from one plant is relayed to the routers on its neighbours, and every reading is kept for the whole season. Anything that moves clear of the plant’s resting level is flagged the moment it lands.'],
    ['04 — Read', 'Dashboard', 'The dashboard shows every router on the network and draws each signal against that plant’s resting level, flagging anything that stands out. Anyone can view it; signing in is only needed to send a test signal.']
  ];

  S.pages.how = {
    title: 'How it works',
    html: function () {
      var flow = FLOW.map(function (f, i) {
        return '<div class="flow-item"><span class="flow-pill ' + f.pill + '"><span class="dot" style="background:' + f.dot + '"></span>' + f.label + '</span>' +
          (i < FLOW.length - 1 ? '<span class="flow-arrow" aria-hidden="true">→</span>' : '') + '</div>';
      }).join('');
      var steps = STEPS.map(function (s) {
        return '<div class="card elev-sm panel"><div class="card-kicker">' + s[0] + '</div><h3 class="card-title">' + s[1] + '</h3><p class="card-body">' + s[2] + '</p></div>';
      }).join('');
      return '<div class="how">' +
        '<div><div class="card-kicker" style="margin-bottom:8px">How it works</div>' +
        '<h1>One router per plant</h1>' +
        '<p class="intro">Think of it as home Wi-Fi for a hedgerow. Each plant gets a router: it reads the plant’s electrical activity, joins the network, passes whatever that plant reports to the other routers, and keeps a record you can read at a glance.</p></div>' +
        '<div class="flow">' + flow + '</div>' +
        '<div class="how-cards">' + steps + '</div>' +
        '<div class="btn-row">' +
        '<a href="#/dashboard" class="btn btn-primary btn-lg">See it on the dashboard</a>' +
        '<a href="#/" class="btn btn-secondary btn-lg">Back to overview</a></div>' +
        S.copyright() + '</div>';
    }
  };
})(window.Saplink);
