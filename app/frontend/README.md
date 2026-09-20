# Saplink

Plant-router monitoring: a marketing site and a live dashboard, both React, talking to
the real API in `app/backend` (FastAPI + SQLite — see that folder, not this one).

**Stack** — React 18 (Vite) + React Router, Tailwind CSS. `server/index.js` (Node/Express)
is a **local dev convenience only** — an in-memory fake-data API so `npm run dev` works
with no backend running. It is not part of the deployed site.

## Run it locally

```bash
npm install
npm run dev      # fake API on :3001, web on :5173 (proxied to it) — no backend needed
```

To develop against the real backend instead, run `app/backend` (see its README/Dockerfile)
and point Vite at it:

```bash
VITE_API_BASE_URL=http://localhost:8000 npm run dev:web
```

## Deploying

There is no `npm start` production path — this app builds to static files and is served
by Caddy, per the repo root's `compose.web.yaml` / `Caddyfile.web`:

```bash
VITE_API_BASE_URL=https://api.<your-domain> npm run build   # -> dist/
```

`compose.web.yaml` already sets `VITE_API_BASE_URL` from `SAPLINK_WEB_DOMAIN` and runs
this build in a `node:22-alpine` container before Caddy serves `dist/` — see `deploy.sh`
at the repo root. The API itself is the separate `app/backend` box (`compose.api.yaml`).

## Routes

| Path | Page |
| --- | --- |
| `/` | Landing — hero, two-plant diagram, mission, sign-up |
| `/how-it-works` | The four-step pipeline |
| `/dashboard` | Live readings, site map, traffic, exports |
| `/account` | Profile and linked routers |

## API

The front end talks to whatever `VITE_API_BASE_URL` points at (empty string = same
origin), via the `apiFetch()` helper in `src/lib/api.js`. Both the real backend and the
local dev simulator answer the same shape:

`GET /api/health` → `{ ok, batches, last_recv, devices }`
`GET /api/readings/latest` → `{ last_id, sample }`
`GET /api/readings/history?since_id=&device=` → `{ last_id, samples: [{ batch_id, device, t_ms, mv, baseline_mv, event, src, soil_mv, seq }] }` — `device` is optional; omit it for every stream, pass one to read a single plant. One board posts a stream per plant, so unfiltered output interleaves them.
`GET /api/news?limit=` → `{ items: [{ id, source, title, link, summary, published_ts }] }` (real backend only, no dev-simulator fake — read-only and public either way)
`GET /api/network` → `{ density, nodes: [{ node_id, device, last_recv, activity }] }` — one node per **electrode pair**, keyed on `node_id`, not per `device`. Two plants on one board are two nodes; a batch posted without a `node_id` (a curl one-liner) is data, not a router, and never appears here. Drives the site map and router-activity list.
`GET /api/auth/me` (with `Authorization: Bearer <google id token>`) → `{ email }`

`t_ms` is the router's own `millis()` clock, not wall-clock time — the dashboard stamps
each sample with the time the browser received it for display/export instead.

The dev simulator (`server/index.js`) additionally fakes `GET /api/alerts`,
`POST /api/alerts/manual`, and `POST /api/alerts/:id/ack` for exercising the "send a test
signal" flow locally. **The real backend's alert plane is built** (`POST /api/alerts`,
`GET /api/alerts/pending`, `POST /api/alerts/{id}/ack` — see `app/backend/main.py`), but
`/api/alerts/manual` specifically was deliberately dropped there: "no browser-reachable
write can run the pump" (that file's module docstring). A 404 against the real API is
expected and permanent by design, not a gap to close — the dashboard falls back to a
clearly labelled preview state, same as when the API is unreachable entirely.

## Structure

```
server/index.js         Express dev-only fake API (see "Run it locally")
src/pages/               Landing, HowItWorks, Dashboard, Account
src/components/          Header, Logo, GoogleMark, Copyright, Mascot, IntroLoader
src/scene/                Procedural branch/foliage scene behind the hero
src/art/                  Static SVG artwork (two-plant diagram, regrowing forest)
src/lib/                  css() style helper, auth, health/network/news polling, apiFetch()
public/organic.css        Design tokens and component classes
public/media/             Intro loader clip (webm/mp4) + poster
```

Styling uses the design tokens in `public/organic.css`; `tailwind.config.js` maps those
same tokens onto Tailwind utilities. The `css()` helper in `src/lib/css.js` turns CSS
declaration strings into React style objects so component styling stays inline and local.
Loader/mascot keyframes and one-off component rules live in `src/index.css`.

## Notes

Sign-in (`src/lib/auth.js`) is real Google Identity Services, verified server-side
against `GET /api/auth/me` — no ID token is trusted client-side. There's no fixed/fake
device roster anywhere in this app anymore — the dashboard's router tabs, Account's
router list, the site map, and "Router activity" are all driven live from
`GET /api/health` and `GET /api/network`; a router that stops reporting just stops
appearing, rather than showing a stale or invented status for it. Soil moisture in the
dashboard's Conditions card is real (Contract A's `soil_mv`, raw ADC mV, not a
calibrated percentage). Air humidity/temperature/light in that same card are openly
labelled as not measured yet — no sensor exists for any of the three (see
`.claude/plan.md`'s Phase 6 note). "Status over time" and canopy-cover figures were
removed rather than backed by fabricated numbers, since neither has a real data source
yet; both are marked "not live yet" the same way Response relay already was.

`Mascot` (bottom-right, cursor-tracking) and `IntroLoader` (session-once splash clip,
skips itself for `prefers-reduced-motion`) are mounted once in `main.jsx` so they persist
across route changes instead of living inside a page.
