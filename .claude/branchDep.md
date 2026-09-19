# Third-Party & Board-Package Version Tracking

Realigned to the actual built stack (SQLite/Caddy, no Postgres/ORM, no frontend package manager). Registries should still be re-checked at install time since versions drift.

## Firmware (PlatformIO, `esp32/Saplink/platformio.ini`)

| Library | Target version (verify at install) | Used by |
|---|---|---|
| Adafruit ADS1X15 | latest on PlatformIO registry | not yet added — needed once `readMv()` swaps synthetic data for a real ADS1115 differential read |
| ESP32 Arduino core (`platform = espressif32`) | pin the exact platform version once picked, not left floating | all esp32dev envs |

`HTTPClient` / `WiFiClientSecure` / `WiFi` ship with the ESP32 Arduino core (`framework = arduino`) — no separate `lib_deps` entry needed; `sensor_main.cpp` already uses all three. `ArduinoJson` is dropped from this list — it's not used; the firmware hand-builds its JSON body with `snprintf` (see `sensor_main.cpp`'s `post()`).

No pending bumps yet — nothing pinned to bump from.

## Backend (`app/backend/requirements.txt`)

| Package | Target version (verify at install) | Notes |
|---|---|---|
| fastapi | unpinned in requirements.txt today — pin at next deploy | API framework |
| uvicorn[standard] | matches fastapi's supported range | ASGI server |
| httpx | latest | test-only (`TestClient` dependency in `test_ingest.py`); harmless in the built image |

SQLite is accessed via Python's stdlib `sqlite3` module — no ORM (`sqlalchemy`) or driver (`psycopg2-binary`) needed. Both are dropped from this list along with the Postgres design they supported.

No pending bumps yet — nothing pinned to bump from.

## Frontend (`app/frontend/`)

No package manager. `app/frontend/` is served directly by Caddy as static files (`file_server`, no build step) — plain HTML/CSS/vanilla JS only. `package.json`, React, Vite, and Tailwind are dropped from this file; if a build step is ever introduced, re-add a tracked table here at that point.

## Infra (repo root)

| Tool | Target version (verify at install) | Notes |
|---|---|---|
| Caddy | `caddy:2-alpine` (Docker image, `2.x` tag family) | TLS termination + static file serving on both `saplink-api` and `saplink-web` boxes; auto-issues Let's Encrypt certs, needs port 80 open for the HTTP-01 challenge |

No pending bumps yet — nothing pinned to bump from.
