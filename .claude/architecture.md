# Architecture

File/module structure and internal component-to-component dependency graph. This describes structural dependencies (what imports/depends on what) — for build order and per-file implementation detail, see `plan.md`.

## Firmware (`esp32/Saplink/`)

```
lib/saplink_common/            (shared, no ESP32-only calls except cloud_client.h/.cpp)
  packet_schema.h              (leaf — no internal deps)
  secrets.h.example            (leaf — no internal deps)
  signal_conditioning.h/.cpp   (leaf — no internal deps)
  peak_detector.h/.cpp         (leaf — no internal deps)
  recorded_signal.h/.cpp       (leaf — no internal deps)
  cloud_client.h/.cpp          --> packet_schema.h, secrets.h

src/
  diagnostic_main.cpp     --> (none; standalone I2C scanner, no shared lib deps)
  combo_main.cpp          --> signal_conditioning.h, peak_detector.h, recorded_signal.h, cloud_client.h, packet_schema.h
  sensor_main.cpp         --> signal_conditioning.h, peak_detector.h, cloud_client.h, packet_schema.h    (stretch)
  actuator_main.cpp       --> cloud_client.h, packet_schema.h                                            (stretch)

test/
  test_signal_pipeline/test_signal_pipeline.cpp  --> signal_conditioning.h, peak_detector.h, recorded_signal.h  (env:native only)
```

Envs (`platformio.ini`): `diagnostic` builds `diagnostic_main.cpp` only; `combo`/`sensor`/`actuator` each build their own `src/*_main.cpp` + all of `lib/saplink_common/`; `native` builds `test/` + `lib/saplink_common/` only (no `src/*_main.cpp`, since those require ESP32 hardware APIs).

## Backend (`app/backend/`)

```
app/
  models.py       (leaf — SQLAlchemy Base + Alert table)
  schemas.py       --> models.py  (Pydantic models mirror the same fields)
  routes.py        --> models.py, schemas.py
  main.py          --> routes.py
Dockerfile          --> requirements.txt (installs at build time)
docker-compose.yml  --> Dockerfile (API service), postgres image (DB service)
```

`models.py`'s `Alert` table fields are the single source of truth for the wire schema — they must stay in sync with `esp32/Saplink/lib/saplink_common/packet_schema.h` by hand (no code generation between the two languages).

## Frontend (`app/frontend/`)

```
src/
  main.jsx          --> App.jsx
  App.jsx           --> lib/dataFeed.js
  lib/dataFeed.js   (leaf — fetch calls to app/backend's REST API only)
index.html          --> src/main.jsx (script tag)
package.json        (declares react, react-dom, vite, tailwindcss)
```

## Cross-cutting dependency (not a file import, a network contract)

`combo_main.cpp`/`sensor_main.cpp`/`actuator_main.cpp` <--HTTP--> `app/backend`'s `routes.py` <--HTTP--> `app/frontend`'s `dataFeed.js`. All three must agree on the same JSON field names (`packet_schema.h` / `schemas.py` / whatever shape `dataFeed.js` expects) — this is the one dependency that crosses the firmware/backend/frontend boundary and isn't enforced by a compiler.
