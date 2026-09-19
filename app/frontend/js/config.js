/* Saplink settings and shared data. Change things here first. */
window.Saplink = window.Saplink || {};

Saplink.config = {
  // Where the monitoring backend lives. saplink-web and saplink-api are two
  // separate boxes/domains (see .claude/plan.md's Runbook) -- this can't be ''
  // (same-origin), it has to name the API's own domain. Endpoints used:
  //   GET  /api/health                        -> { ok, devices[], batches, last_recv }
  //   GET  /api/readings/history?since_id=N   -> { last_id, samples: [{ batch_id, device, t_ms, mv, baseline_mv, event, src, soil_mv, seq }] }
  //     (no threshold_mv yet -- that's a Contract B/alerts concept, Phase 5, unbuilt)
  //   POST /api/alerts/manual                 -> sends a test signal (Phase 5, unbuilt -- 404s gracefully today)
  // When these are not reachable the pages fall back to a simulated preview feed.
  apiBase: 'https://api.saplink.us',

  // Google OAuth Web Client ID for real sign-in (js/auth.js). Must be a Web
  // application OAuth client at console.cloud.google.com with
  // https://saplink.us and https://www.saplink.us as Authorized JavaScript
  // origins (no redirect URI needed), and must exactly match the api box's
  // GOOGLE_CLIENT_ID .env value (see .claude/plan.md Phase 7's Gotchas) --
  // same client id on both sides or every token fails verification.
  // Left as this placeholder, sign-in buttons simply don't render.
  googleClientId: 'REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID',

  // Landing-page canopy scene.
  scene: {
    branchLayout: 'Overhead canopy', // 'Overhead canopy' | 'Left arch' | 'Corner diagonal'
    windStrength: 1,                 // 0 - 2.5
    motionSpeed: 1,                  // 0.4 - 2
    parallaxDepth: 1,                // 0 - 2
    showDrips: false,
    dripInterval: 7                  // seconds
  }
};

Saplink.pages = {};

Saplink.api = function (path, opts) {
  return fetch(Saplink.config.apiBase + path, opts);
};

/* The plants that have a router on them. Used by the dashboard. */
Saplink.roster = [
  { id: 'sense-1', label: 'sense-1', x: 118, y: 96,  status: 'ok',    canopy: 52, plant: 'Common Hazel · Hollow Field, east hedge' },
  { id: 'sense-2', label: 'sense-2', x: 214, y: 158, status: 'ok',    canopy: 41, plant: 'Pedunculate Oak · Hollow Field, veteran tree' },
  { id: 'sense-3', label: 'sense-3', x: 336, y: 112, status: 'ok',    canopy: 29, plant: 'Grey Willow · Wet meadow, south ditch' },
  { id: 'sense-4', label: 'sense-4', x: 448, y: 198, status: 'quiet', canopy: 18, plant: 'Silver Birch · North slope, cleared block' },
  { id: 'sense-5', label: 'sense-5', x: 276, y: 244, status: 'ok',    canopy: 24, plant: 'Blackthorn · Wet meadow, west scrub' }
];

/* Routers linked to the signed-in account. Used by the account page. */
Saplink.probes = [
  { id: 'sense-1', plant: 'Common Hazel',    latin: 'Corylus avellana', site: 'Hollow Field, east hedge',    baseline: '42.0 mV', last: '4 seconds ago',  status: 'Reporting' },
  { id: 'sense-2', plant: 'Pedunculate Oak', latin: 'Quercus robur',    site: 'Hollow Field, veteran tree',  baseline: '38.6 mV', last: '11 seconds ago', status: 'Reporting' },
  { id: 'sense-3', plant: 'Grey Willow',     latin: 'Salix cinerea',    site: 'Wet meadow, south ditch',     baseline: '45.2 mV', last: '9 seconds ago',  status: 'Reporting' },
  { id: 'sense-4', plant: 'Silver Birch',    latin: 'Betula pendula',   site: 'North slope, cleared block',  baseline: '40.1 mV', last: '6 hours ago',    status: 'Battery low' },
  { id: 'sense-5', plant: 'Blackthorn',      latin: 'Prunus spinosa',   site: 'Wet meadow, west scrub',      baseline: '43.4 mV', last: '7 seconds ago',  status: 'Reporting' }
];
