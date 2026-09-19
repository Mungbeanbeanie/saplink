# Architecture

File/module structure and internal component-to-component dependency graph. This describes structural dependencies (what imports/depends on what) — for build order and per-file implementation detail, see `plan.md`.

## Firmware (`esp32/Saplink/`)

```
include/
  secrets.h.example        (leaf — WIFI_SSID, WIFI_PASS, SAPLINK_TOKEN, SAPLINK_URL, DEVICE_ID; real secrets.h gitignored)

src/
  diagnostic_main.cpp   --> (none; standalone I2C scanner, no shared lib deps)
  sensor_main.cpp        --> include/secrets.h   (built — WiFi connect + batch + HTTPS POST, all inline, no shared lib)
  combo_main.cpp          --> include/secrets.h, lib/saplink_common/signal_conditioning.h, lib/saplink_common/peak_detector.h, lib/saplink_common/recorded_signal.h   (planned — primary target)
  actuator_main.cpp       --> include/secrets.h   (planned — stretch)

lib/saplink_common/       (does not exist yet — created by Phase 2's first file)
  signal_conditioning.h/.cpp   (leaf — no internal deps)
  peak_detector.h/.cpp         (leaf — no internal deps)
  recorded_signal.h/.cpp       (leaf — no internal deps)

test/
  test_signal_pipeline/test_signal_pipeline.cpp  --> lib/saplink_common/{signal_conditioning,peak_detector,recorded_signal}.h  (env:native only)
```

Envs (`platformio.ini`): `diagnostic` builds `diagnostic_main.cpp` only; `sensor`/`combo`/`actuator` each build their own `src/*_main.cpp` (plus `lib/saplink_common/**` once it exists); `native` builds `test/` + `lib/saplink_common/**` only (no `src/*_main.cpp`, since those require ESP32 hardware APIs). No `cloud_client.h`/`packet_schema.h` — both dropped, see `plan.md` Phase 1/3.

## Backend (`app/backend/`)

```
app/backend/
  main.py           (single file — FastAPI app, Pydantic `Batch` model, sqlite3 connection/schema/queries, all endpoints. No models.py/schemas.py/routes.py split.)
  requirements.txt  (leaf)
  Dockerfile         --> requirements.txt (installs at build time; source arrives via bind mount, not copied in)
  test_ingest.py     --> main.py (imports `app` directly, drives it with FastAPI's TestClient)
```

`main.py`'s `Batch` Pydantic model is the single source of truth for the wire schema — it must stay in sync with `esp32/Saplink/src/sensor_main.cpp`'s (and eventually `combo_main.cpp`'s) hand-built JSON by hand, no code generation between the two languages. Canonical description of the contract: `overview.md`'s "Interface Schema" bullet.

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
config.js    (leaf — defines `window.SAPLINK_API`, the one thing every page/script needs)
index.html   --> config.js (script tag) + inline/plain JS fetch-polling logic; no build step, no npm, no React/Vite/Tailwind
```

## Cross-cutting dependency (not a file import, a network contract)

`esp32/Saplink/src/sensor_main.cpp` (and eventually `combo_main.cpp`) <--HTTP--> `app/backend/main.py`'s `Batch` model <--HTTP--> `app/frontend`'s fetch calls against `window.SAPLINK_API`. All three must agree on the same JSON shape — canonically documented in `overview.md`'s "Interface Schema" bullet (update there first, then this file and `plan.md`, to avoid the same fields drifting across three separate descriptions of one contract).
