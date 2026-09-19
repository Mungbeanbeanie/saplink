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
`GET /api/readings/history?since_id=` → `{ last_id, samples: [{ batch_id, device, t_ms, mv, baseline_mv, event, src, soil_mv, seq }] }`

`t_ms` is the router's own `millis()` clock, not wall-clock time — the dashboard stamps
each sample with the time the browser received it for display/export instead.

The dev simulator (`server/index.js`) additionally fakes `GET /api/alerts`,
`POST /api/alerts/manual`, and `POST /api/alerts/:id/ack` for exercising the "send a test
signal" flow locally. **The real backend does not implement these yet** (see the module
docstring in `app/backend/main.py`) — hitting them against the real API 404s, and the
dashboard falls back to a clearly labelled preview state, same as when the API is
unreachable entirely.

## Structure

```
server/index.js         Express dev-only fake API (see "Run it locally")
src/pages/               Landing, HowItWorks, Dashboard, Account
src/components/          Header, Logo, GoogleMark, Copyright, Mascot, IntroLoader
src/scene/                Procedural branch/foliage scene behind the hero
src/art/                  Static SVG artwork (two-plant diagram, regrowing forest)
src/data/roster.js        The router roster — one source for map, tabs, traffic, account
src/lib/                  css() style helper, auth, health polling, apiFetch()
public/organic.css        Design tokens and component classes
public/media/             Intro loader clip (webm/mp4) + poster
```

Styling uses the design tokens in `public/organic.css`; `tailwind.config.js` maps those
same tokens onto Tailwind utilities. The `css()` helper in `src/lib/css.js` turns CSS
declaration strings into React style objects so component styling stays inline and local.
Loader/mascot keyframes and one-off component rules live in `src/index.css`.

## Notes

Sign-in is stubbed in `src/lib/auth.js` (localStorage) — wire Google Identity Services
there against `GET /api/auth/me` on the real backend, and gate write endpoints
server-side. Conditions, canopy figures and traffic rates are placeholders.

`Mascot` (bottom-right, cursor-tracking) and `IntroLoader` (session-once splash clip,
skips itself for `prefers-reduced-motion`) are mounted once in `main.jsx` so they persist
across route changes instead of living inside a page.
