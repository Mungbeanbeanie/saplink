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
  requirements.txt  (leaf)
  Dockerfile         --> requirements.txt (installs at build time; source arrives via bind mount, not copied in)
  test_ingest.py     --> main.py (imports `app` directly, drives it with FastAPI's TestClient)
```

`main.py`'s `Batch` Pydantic model is the single source of truth for the wire schema — it must stay in sync with `esp32/Saplink/src/sensor_main.cpp`'s (and eventually `combo_main.cpp`'s) hand-built JSON by hand, no code generation between the two languages. Canonical description of the contract: `overview.md`'s "Interface Schema" bullet.

`main.py` also gains the live-signal classifier (Phase 5, not yet built) — a Python port of `esp32/Saplink/lib/saplink_common/peak_detector.h`'s 3σ+rebound-ratio algorithm, run against each ingested `Batch.mv` per-device against a running EMA baseline/sigma it maintains itself (in-memory or a small table, TBD at implementation time). Still one file, no new module — matches the existing no-models/schemas/routes-split convention. On a fire it writes a pending Contract B alert row for the alert-plane routes to serve.

## Deploy infrastructure (repo root)

```
Caddyfile.api       --> consumed by compose.api.yaml's `caddy` service (reverse-proxies to api:8000, auto TLS)
Caddyfile.web       --> consumed by compose.web.yaml's `caddy` service (serves app/frontend/ static files)
compose.api.yaml    --> app/backend/Dockerfile (api service), caddy:2-alpine image, Caddyfile.api
compose.web.yaml    --> caddy:2-alpine image, Caddyfile.web, app/frontend/ (read-only bind mount)
deploy.sh           --> ssh + git pull + `docker compose -f compose.<role>.yaml up -d --build`, per compose file above
```

Two independent Vultr boxes (`saplink-api`, `saplink-web`), each with its own Caddy for TLS — not a single droplet running one Docker Compose stack.

## Frontend (`app/frontend/`)

```
index.html              --> js/svg.js, js/config.js, js/store.js, js/pages/*.js, js/app.js (script tags, load order matters)
css/organic.css          (leaf — base/reset + procedural canopy-scene styling)
css/site.css             (leaf — page/component styling)

js/svg.js                (leaf — extracted inline art: logo, Google icon, landing diagrams)
js/config.js             (leaf — Saplink.config incl. apiBase, Saplink.api(path,opts) fetch helper, roster/probes fixtures)
js/store.js             --> window.claude (optional artifact DB capability), localStorage   (signal-history persistence, feeds dashboard chart + CSV/JSON export)
js/pages/landing.js     --> js/svg.js, js/config.js   (#/ route: canopy scene + health-pill polling /api/health)
js/pages/how.js         --> js/config.js               (#/how-it-works route, static)
js/pages/dashboard.js   --> js/config.js, js/store.js  (#/dashboard route — the only page hitting live readings: /api/health, /api/readings/history, /api/alerts/manual)
js/pages/account.js     --> js/config.js               (#/account route, static fixture data)
js/app.js               --> js/config.js, js/pages/*.js  (hash router + header/nav shell + local-only sign-in state)
```

No build step, no npm, no React/Vite/Tailwind — this diverges from `plan.md`'s originally-planned React/Vite/Tailwind SPA (see that phase for why). `Saplink.config.apiBase` (in `js/config.js`) is the one thing every page needs, replacing the earlier planned `window.SAPLINK_API` global.

## Cross-cutting dependency (not a file import, a network contract)

`esp32/Saplink/src/sensor_main.cpp` (and eventually `combo_main.cpp`) <--HTTP--> `app/backend/main.py`'s `Batch` model <--HTTP--> `app/frontend`'s fetch calls against `window.SAPLINK_API`. All three must agree on the same JSON shape — canonically documented in `overview.md`'s "Interface Schema" bullet (update there first, then this file and `plan.md`, to avoid the same fields drifting across three separate descriptions of one contract).
