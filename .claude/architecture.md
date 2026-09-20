# Architecture

File/module structure and internal component-to-component dependency graph. This describes structural dependencies (what imports/depends on what) — for build order and per-file implementation detail, see `plan.md`.

## Firmware (`esp32/Saplink/`)

```
include/
  secrets.h.example        (leaf — WIFI_SSID, WIFI_PASS, SAPLINK_TOKEN, SAPLINK_URL, DEVICE_ID; real secrets.h gitignored)

src/
  diagnostic_main.cpp   --> (none; standalone I2C scanner, no shared lib deps)
  sensor_main.cpp        --> include/secrets.h   (built — WiFi connect + batch + HTTPS POST, all inline, no shared lib)
  combo_main.cpp          --> include/secrets.h, lib/saplink_common/signal_conditioning.h, lib/saplink_common/peak_detector.h, lib/saplink_common/recorded_signal.h   (planned — primary target; not yet wired to lib/saplink_common/cloud_client.h, that lands with Phase 4's actuate half)
  actuator_main.cpp       --> include/secrets.h   (planned — stretch)

lib/saplink_common/
  packet_schema.h               (leaf — Contract B's alert struct, no internal deps)
  signal_conditioning.h/.cpp    (leaf — no internal deps)
  peak_detector.h/.cpp          (leaf — no internal deps)
  recorded_signal.h/.cpp        (leaf — no internal deps)
  cloud_client.h/.cpp           --> packet_schema.h, include/secrets.h   (built — alert-plane HTTPS client; excluded from env:native's build, needs Arduino/WiFi, not testable off-device)

test/
  test_signal_pipeline/test_signal_pipeline.cpp  --> lib/saplink_common/{signal_conditioning,peak_detector,recorded_signal}.h  (env:native only)
```

Envs (`platformio.ini`): `diagnostic` builds `diagnostic_main.cpp` only; `sensor`/`combo`/`actuator` each build their own `src/*_main.cpp` (plus `lib/saplink_common/**`); `native` builds `test/` + `lib/saplink_common/**` minus `cloud_client.*` (no `src/*_main.cpp`, since those require ESP32 hardware APIs, and no `cloud_client.*`, since it requires Arduino/WiFi headers that don't exist under `platform = native`).

## Backend (`app/backend/`)

```
app/backend/
  main.py           (single file — FastAPI app, Pydantic `Batch` model, sqlite3 connection/schema/queries, all endpoints. No models.py/schemas.py/routes.py split.)
  news.py           --> main.py (ecology RSS ingestion; background refresh thread + `news` SQLite table -- split out per main.py's own docstring escape hatch, "split back out if it gets unwieldy")
  weather.py        --> main.py (Blacksburg current temperature via Open-Meteo; background refresh thread, in-memory cache only -- one current value, not an accumulating history, so no DB table like news.py has)
  requirements.txt  (leaf)
  Dockerfile         --> requirements.txt (installs at build time; source arrives via bind mount, not copied in)
  test_ingest.py     --> main.py (imports `app` directly, drives it with FastAPI's TestClient)
```

`main.py`'s `Batch` Pydantic model is the single source of truth for the wire schema — it must stay in sync with `esp32/Saplink/src/sensor_main.cpp`'s (and eventually `combo_main.cpp`'s) hand-built JSON by hand, no code generation between the two languages. Canonical description of the contract: `overview.md`'s "Interface Schema" bullet.

`main.py` also gains the live-signal classifier (Phase 5, not yet built) — a Python port of `esp32/Saplink/lib/saplink_common/peak_detector.h`'s 3σ+rebound-ratio algorithm, run against each ingested `Batch.mv` per-device against a running EMA baseline/sigma it maintains itself (in-memory or a small table, TBD at implementation time). Still one file, no new module — matches the existing no-models/schemas/routes-split convention. On a fire it writes a pending Contract B alert row for the alert-plane routes to serve.

## Deploy infrastructure (repo root)

```
Caddyfile.api       --> consumed by compose.api.yaml's `caddy` service (reverse-proxies to api:8000, auto TLS)
Caddyfile.web       --> consumed by compose.web.yaml's `caddy` service (serves app/frontend/dist/, built fresh each deploy)
compose.api.yaml    --> app/backend/Dockerfile (api service), caddy:2-alpine image, Caddyfile.api
compose.web.yaml    --> node:22-alpine `build` service (npm ci && npm run build, app/frontend/ -> app/frontend/dist/), caddy:2-alpine image, Caddyfile.web, app/frontend/dist/ (read-only bind mount)
deploy.sh           --> ssh + git pull + `docker compose -f compose.<role>.yaml up -d --build`, per compose file above
```

Two independent Vultr boxes (`saplink-api`, `saplink-web`), each with its own Caddy for TLS — not a single droplet running one Docker Compose stack.

## Frontend (`app/frontend/`)

React 18 + Vite + React Router + Tailwind, built to static `dist/` (see Deploy infrastructure above) — this is the second rewrite; a vanilla hash-routed JS version existed briefly in between and is gone, not kept.

```
index.html               --> src/main.jsx (Vite entry)
src/main.jsx             --> react-router-dom, src/pages/*.jsx, src/components/{Mascot,IntroLoader}.jsx

src/lib/api.js            (leaf — API_BASE from VITE_API_BASE_URL, apiFetch(path,opts))
src/lib/auth.js          --> src/lib/api.js   (real Google Identity Services; module-level singleton + useAuth() via useSyncExternalStore, since GIS's callback fires outside React's render cycle)
src/lib/news.js          --> src/lib/api.js   (useNews(limit) hook, polls GET /api/news)
src/lib/network.js       --> src/lib/api.js   (useNetwork() hook, polls GET /api/network -- density + per-device activity for the site-map graph)
src/lib/statusHistory.js --> src/lib/api.js   (useStatusHistory(device,hours) hook, polls GET /api/status_history -- hour-bucketed batch/event counts for the "Status over time" strip)
src/lib/weather.js       --> src/lib/api.js   (useWeather() hook, polls GET /api/weather -- Blacksburg's current outdoor temperature, fixed location)
src/lib/useHealth.js     --> src/lib/api.js   (GET /api/health polling hook)
src/lib/css.js            (leaf — CSS-declaration-string -> React style object helper)
src/data/roster.js         (leaf — the 5-plant fixture: dashboard map/tabs, account's router list; not reconciled with /api/health's real `devices`)

src/components/GoogleSignInButton.jsx --> src/lib/auth.js   (renders Google's own button into a ref'd container; used by Header/Landing/Account/Dashboard wherever "Sign in" appears)
src/components/Header.jsx             --> src/lib/auth.js, src/components/{Logo,GoogleSignInButton}.jsx
src/components/{Copyright,Logo,Mascot,IntroLoader}.jsx  (leaves — no data deps)
src/scene/BranchScene.jsx              (leaf — procedural canopy scene behind the landing hero)
src/art/artwork.js                     (leaf — static SVG art strings)

src/pages/Landing.jsx     --> src/components/Header.jsx, src/components/GoogleSignInButton.jsx, src/scene/BranchScene.jsx, src/lib/useHealth.js
src/pages/HowItWorks.jsx --> src/components/Header.jsx   (static)
src/pages/Dashboard.jsx  --> src/components/{Header,GoogleSignInButton}.jsx, src/lib/{api,auth,news,network,statusHistory}.js   (the only page hitting live readings: /api/health, /api/readings/history?device=, /api/network, /api/status_history, /api/alerts/manual; also renders the news card. No longer depends on src/data/roster.js -- that fixture was dropped, device tabs now come from /api/health's real device list. Does NOT depend on src/lib/weather.js -- that hook exists and works but nothing currently renders it, see plan.md's Outdoor temperature note)
src/pages/Account.jsx    --> src/components/{Header,GoogleSignInButton}.jsx, src/lib/auth.js, src/data/roster.js   (gates on signedIn)

server/index.js            (leaf, LOCAL DEV ONLY — Express fake API for `npm run dev`, not part of deployment)
```

`API_BASE`/`VITE_GOOGLE_CLIENT_ID` are both build-time env vars (`import.meta.env.*`), injected by `compose.web.yaml`'s `build` service — there is no runtime config file the way the earlier vanilla pass had one.

## Cross-cutting dependency (not a file import, a network contract)

`esp32/Saplink/src/combo_main.cpp` (posting readings and, per the firmware, alerts too) <--HTTP--> `app/backend/main.py`'s `Batch`/`AlertIn` models <--HTTP--> `app/frontend/src/lib/api.js`'s `apiFetch()` calls. All three must agree on the same JSON shape — canonically documented in `overview.md`'s "Interface Schema" bullet (update there first, then this file and `plan.md`, to avoid the same fields drifting across three separate descriptions of one contract). Google ID tokens are a separate, parallel contract: `app/frontend/src/lib/auth.js` <--HTTP--> `main.py`'s `_google_user()`/`GET /api/auth/me`, verified against `GOOGLE_CLIENT_ID`, which must match on both sides exactly.
