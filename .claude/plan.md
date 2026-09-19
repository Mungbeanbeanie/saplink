# Build Plan

- Checklist, worked top-to-bottom. Each item is exactly one file with a single responsibility — `stage`/`apply` should be able to touch one checklist item without needing to also change any other file. Phases are ordered by dependency (later phases consume earlier ones).
- Phases 1–4 are firmware, 5 the backend, 6 the frontend. The **Runbook** at the bottom is the operational half: topology, deploy commands, and the gotchas that bite on demo day.

---

## Current divergences from overview.md

- **One ESP32 total, nothing wired to it.** The two-node ESP-NOW relay (sense node → actuator node) in `overview.md` is not built; ESP-NOW is dropped entirely in favour of WiFi/HTTPS. One board senses *and* actuates (`combo_main.cpp`). Revisit if a second board appears.
- **No ADS1115, no electrodes yet.** `readMv()` returns a synthetic waveform tagged `"src":"sim"`. Swapping in real reads is one function body — see [The seam](#the-seam).
- **SQLite, not Postgres** (Phase 5). No extra container, no `DATABASE_URL` wiring. Revisit only if concurrent writes become real; they won't at 10 Hz for a weekend.

---

## Locked contracts

Two separate schemas. Don't merge them — they answer different questions.

### A. Readings (telemetry stream) — **built**

Continuous sample batches, the dashboard's chart data. Owned by `app/backend/main.py`.

**`POST https://api.<domain>/api/readings`** — header `Authorization: Bearer <SAPLINK_TOKEN>`

```json
{
  "device": "sense-1",
  "seq": 42,
  "t_ms": 123456,
  "period_ms": 100,
  "baseline_mv": -11.83,
  "event": null,
  "src": "sim",
  "mv": [-12.4, -12.1, -11.9]
}
```

- `seq` — monotonic per boot. Gaps mean dropped batches.
- `t_ms` — `millis()` at the **first** sample. Sample *i* is at `t_ms + i*period_ms`.
- `src` — `"sim"` or `"ads1115"`. On stage this is how you tell live data from synthetic.
- `baseline_mv` / `event` — in the schema from day one so Phase 2's auto-zero and classifier land without a schema change. Firmware sends a running mean and `null` until then.

| route | returns |
|---|---|
| `GET /api/readings/history?since_id=0&limit=200` | `{"last_id", "samples":[{batch_id, device, t_ms, mv, baseline_mv, event, src}]}` — flattened from batches. **`limit` counts batches** (~32 samples each). Poll with the returned `last_id`. |
| `GET /api/readings/latest` | most recent sample + its batch metadata |
| `GET /api/health` | `{"ok", "batches", "last_recv", "devices"}` |

Bounds enforced by Pydantic: `device` ≤32 chars, `period_ms` 1–60000, `mv` ≤256 items each −5000..5000 mV, `event` ∈ {null,"spike"}, `src` ∈ {"sim","ads1115"}. Bad token → 401, malformed → 422.

### B. Alerts (event control plane) — **not built**

Discrete fires plus an ack state machine, driving the actuator. Phase 1's `packet_schema.h` and Phase 5's `/api/alerts/*` routes. Fields: `node_id`, `event_type` (`VP_SPIKE`|`REPLAY_TRIGGER`), `voltage_mv`, `threshold_mv`, `timestamp_ms`. Firmware and backend must match these names exactly.

---

## Phase 1: Firmware Workspace Scaffold & Shared Primitives

- Single physical ESP32 + single ADS1115 reused across every role (diagnostic/sensor/actuator/combo) and even across multiple plants (separate ADS1115 channels, not separate ADCs) — envs and WiFi config come first so no later file guesses at a format or credential source the others don't agree on yet.

- [x] `esp32/Saplink/platformio.ini` — declares `env:diagnostic`, `env:sensor`, `env:actuator`, `env:combo`, `env:native`; each of the first four sets `build_src_filter` to its own `src/<role>_main.cpp` and inherits `platform=espressif32`/`board=esp32dev`/`framework=arduino`/`monitor_speed=115200`. `env:native` uses `platform = native` to build/run `test/`'s Unity tests against `lib/saplink_common/**` with no ESP32/ADS1115 hardware attached. `env:combo` is the primary hardware build target. (No default env — a bare `pio run` tries every env including ones whose source files don't exist yet, so always pass `-e`.)
- [x] `esp32/Saplink/src/diagnostic_main.cpp` — existing I2C bus scanner (`pulledUpExternally`, `riseCycles`, `capacitanceProbe`, `sweep`, `scan`) moved verbatim from the original `src/main.cpp`, no logic changes. Stays the permanent tool for re-verifying ADS1115 wiring (expected 0x48–0x4B) whenever probes/wiring change. (Verified: `pio run -e diagnostic` succeeds.)
- [x] `esp32/Saplink/lib/saplink_common/packet_schema.h` — Contract **B**'s alert schema (see Locked Contracts above): `node_id` (uint8_t), `event_type` (enum `VP_SPIKE`, `REPLAY_TRIGGER`), `voltage_mv` (float), `threshold_mv` (float), `timestamp_ms` (uint32_t, `millis()` at capture). Field names must match whatever Pydantic model Phase 5's alert routes end up using, exactly. Serialize with hand-built `snprintf` JSON, matching `combo_main.cpp`'s existing style for Contract A — unless the shape gets complex enough that pulling in ArduinoJson pays for itself; no decision made yet either way. Contract **A** (readings) is separate and already live, no dependency on this file.
- [x] `esp32/Saplink/include/secrets.h.example` — built at `include/`, not `lib/saplink_common/` (simplification: PlatformIO's default `include/` search path needs no explicit `-I` flag, unlike a lib subfolder — no revisit needed). Fields: `WIFI_SSID`, `WIFI_PASS`, `SAPLINK_TOKEN` (must match the api box's `.env`), `SAPLINK_URL` (`https://api.<domain>/api/readings`), `DEVICE_ID` (per-node identifier, e.g. `"sense-1"`). Real `secrets.h` is gitignored, copied from this template.

---

## Phase 2: Sense Subsystem Primitives

- Pure, testable-in-isolation modules — no networking, no I/O beyond the ADC read — built before the actuate loop so signal quality can be checked before more complexity is added. This is the first real content in `lib/saplink_common/`, which doesn't exist on disk yet — the first item below creates it.

- [ ] `esp32/Saplink/lib/saplink_common/signal_conditioning.h/.cpp` — `class SignalConditioner`: `float update(float raw_mv)` runs a small fixed-window median filter (odd window, e.g. 5 samples), then a 60Hz notch (biquad), then subtracts a slow-adapting baseline (`baseline += (filtered - baseline) * alpha`). Exposes `float baseline() const` for serial debug logging. Meant to be called from `combo_main.cpp`'s sense loop, in place of its raw `readMv()` passthrough.
- [ ] `esp32/Saplink/lib/saplink_common/peak_detector.h/.cpp` — `class PeakDetector`: `bool check(float conditioned_mv, float baseline_sigma)` classifies a candidate deflection as a real Action Potential using TommyVaninetti/PlantLeaf's documented criteria — initial deflection exceeds 3σ of the rolling baseline noise floor, and the signal's rebound back toward baseline reaches ≥30% of that initial deflection (rejects single-direction drift/noise that never rebounds). Output maps directly to Contract A's `event` field — `check()` returning true means the batch currently being built should send `event:"spike"` instead of `null`.
- [ ] `esp32/Saplink/lib/saplink_common/recorded_signal.h/.cpp` — `const float RECORDED_VP_WAVEFORM[]` (PROGMEM), sourced from a real reference VP spike recording — adapted from BackyardBrains Plant-SpikerBox/SpikeRecorder sample data or ETigerschuss/conduction-velocity-plants, not a synthetic/made-up shape — + `class RecordedSignalPlayer`: `void trigger()` (armed via serial command or GPIO button) and `bool nextSample(float& out_mv)`, feeding the array through the same `SignalConditioner`/`PeakDetector` pipeline live probes use. This is the primary mechanism for the single-plant demo's artificial "alert" signal, invoked from `combo_main.cpp`'s loop to synthesize a spike batch on demand.
- [ ] `esp32/Saplink/test/test_signal_pipeline/test_signal_pipeline.cpp` — PlatformIO Unity test under `env:native` (Phase 1), runs on a dev machine with no ESP32/ADS1115 attached. Feeds `SignalConditioner`+`PeakDetector` two fixtures: (a) synthetic noise-only input — must NOT fire, catching false positives; (b) `recorded_signal.h`'s reference VP waveform — must fire and classify as an Action Potential. Validates the from-scratch filter/classifier logic against a known-good real plant-signal shape before ever depending on a live plant.

---

## Phase 3: Route Subsystem (Cloud Transport)

- Needs `packet_schema.h` and `secrets.h` (Phase 1) before it can serialize or connect anywhere. Renamed from "Wireless Transport" — ESP-NOW is dropped; WiFi/HTTPS to the Vultr backend is the only transport now.

- [ ] `esp32/Saplink/lib/saplink_common/cloud_client.h/.cpp` — `class CloudClient`: `bool begin()` (`WiFi.begin(ssid, pass)` from `secrets.h`, blocks until connected), `bool postAlert(const PacketSchema& pkt)` (HTTPS POST JSON to `<API_BASE_URL>/api/alerts`), `bool pollPendingAlert(PacketSchema& out)` (HTTPS GET `<API_BASE_URL>/api/alerts/pending`), `bool ackAlert(int alert_id)` (HTTPS POST `<API_BASE_URL>/api/alerts/{id}/ack`). (The readings half — WiFi connect + HTTPS POST of Contract **A** — already exists inline in `combo_main.cpp` using `snprintf`, no ArduinoJson. Extract into this class when the alert half is written, or leave it inline if that stays simpler.)

---

## Phase 4: Node Firmware Entry Points

- Primary target is single-plant, single-board: `combo_main.cpp` does both sense and actuate on one ESP32, since a real two-plant setup needs a second full hardware set that isn't in hand yet — and even then, both plants' probes would likely feed the same ADS1115's separate channels rather than needing a second ADS1115. `combo_main.cpp` absorbed what was originally sketched as a separate `sensor_main.cpp`'s role once it became clear the same board would eventually need to actuate too — `sensor_main.cpp`/`actuator_main.cpp` below are stretch items for a *dedicated* second board, not files that already exist under those names.

- [ ] `esp32/Saplink/src/combo_main.cpp` — **primary entrypoint, partially built.** Landed and compiling today: WiFi join with retry (`wifiUp()`), the `readMv()` seam (synthetic wander+spike, `SRC="sim"`), 32-sample batches at 10Hz, and HTTPS POST of Contract A to `/api/readings`. Outstanding: swap `readMv()` for a real ADS1115 differential read; wire in Phase 2's `SignalConditioner`/`PeakDetector`/`RecordedSignalPlayer`; and add the poll+actuate+ack half (drives the relay/pump/LED per the Actuate design, using whatever Contract B alert routes Phase 5 builds), then acking so the same alert can't fire twice. **Blocked** on Phase 5's alert control plane not existing yet.
- [ ] `esp32/Saplink/src/sensor_main.cpp` — (stretch — two-plant demo only, not built) Sensing-only role for a dedicated origin-plant board: `setup()`/`loop()` mirroring `combo_main.cpp`'s sense half, minus the poll/actuate side.
- [ ] `esp32/Saplink/src/actuator_main.cpp` — (stretch — two-plant demo only, not built) Actuate-only role for a dedicated target-plant board: polls/acks/actuates, mirroring `combo_main.cpp`'s eventual actuate half. Blocked on the same Phase 5 alert mechanism as `combo_main.cpp`.

---

## Phase 5: Cloud Backend (Vultr, Dockerized API + SQLite)

- Sequenced after firmware so the alert schema it exposes is already locked (Phase 1). Replaces the earlier local-JSON-capture design entirely — the ESP32 now talks straight to this backend, and the frontend (Phase 6) reads straight from it too.
- **Two Vultr boxes, not one** — backend and frontend are separate instances so the API stays standalone and a future iOS app is just another client. Cost: they are no longer same-origin, so CORS is mandatory.

- [x] `app/backend/requirements.txt` — `fastapi`, `uvicorn[standard]`, `httpx` (TestClient only). (No `sqlalchemy`/`psycopg2-binary` — SQLite via stdlib `sqlite3`; `pydantic` comes with fastapi. Unpinned; pin if a deploy ever breaks on a new release.)
- [x] `app/backend/main.py` — single-file FastAPI app: `Batch` Pydantic model (contract **A**), stdlib `sqlite3` with WAL, `CORSMiddleware` from `SAPLINK_WEB_ORIGIN`, bearer-token auth via `hmac.compare_digest`, and the `/api/readings*` + `/api/health` routes. (Collapses the original `app/{models,schemas,routes,main}.py` split into one file — no ORM, one table, ~130 lines. Split back out if the alert plane makes it unwieldy.)
- [ ] alert control plane — `POST /api/alerts`, `GET /api/alerts/pending`, `POST /api/alerts/{id}/ack`, `POST /api/alerts/manual` (dashboard-injected artificial alert, `event_type=REPLAY_TRIGGER`). Contract **B**: needs an `acked` flag and an oldest-un-acked query. Add to `main.py`, or split to `routes.py` if it grows. **This is the gap blocking `combo_main.cpp`'s actuate half (Phase 4)** — no design decision made yet.
- [x] `app/backend/test_ingest.py` — self-running asserts (`python test_ingest.py`; pytest optional): POST round-trips through history, bad token → 401, out-of-range → 422, `/api/readings/latest` returns the right sample.
- [x] `app/backend/Dockerfile` — `python:3.12-slim`, installs `requirements.txt` only; source arrives via bind mount so code changes need no rebuild.
- [x] `compose.api.yaml` / `compose.web.yaml` + `Caddyfile.api` / `Caddyfile.web` / `deploy.sh` at repo root — one compose file per box role, each with its own Caddy for automatic TLS. (Replaces the single `app/backend/docker-compose.yml`; no postgres container.)
- [ ] Both Vultr instances provisioned, DNS pointed, `.env` written, first `docker compose up` green — see [Runbook > Remaining to first green demo](#remaining-to-first-green-demo) for the full infra checklist.

---

## Phase 6: Frontend Dashboard (React, standalone)

- Last phase, consumes only Phase 5's API. Fully decoupled — no shared code with the backend beyond the schema shape, per user's "separate standalone" direction.
- Served from the `saplink-web` box. **Caddy serves `app/frontend/dist/`**, not the source dir — a Vite project needs a build step, run on the box during `./deploy.sh web`.

- [ ] `app/frontend/package.json` — Node scaffold: `react`, `react-dom`, `vite`, `tailwindcss` + PostCSS/autoprefixer peers. Replaces the current bare `index.html` placeholder with an actual buildable project.
- [ ] `app/frontend/index.html` — Vite entry HTML (`<div id="root">` + module script to `src/main.jsx`), replacing today's empty placeholder.
- [ ] `app/frontend/src/main.jsx` — `ReactDOM.createRoot(...).render(<App />)`, imports Tailwind base CSS.
- [ ] `app/frontend/src/App.jsx` — dashboard layout matching the Hackathon Demo Workflow: live baseline voltage panel(s) (from `GET /api/readings/history`), a VP-spike alert banner (from `GET /api/readings/latest`), an actuation-status indicator ("Target Network Node Primed"), and a manual replay-trigger button that calls `POST /api/alerts/manual`.
- [ ] `app/frontend/src/lib/dataFeed.js` — `useReadings()` hook: polls the Vultr API's `/api/readings/latest` and `/api/readings/history` endpoints on an interval (base URL from a Vite env var, `VITE_API_BASE_URL`), returns current reading + rolling history array to `App.jsx`; also exposes a `postManualAlert()` call for the replay button.
- [ ] `compose.web.yaml` gains a node build stage running `npm ci && npm run build`, and `Caddyfile.web` roots at `dist/`.

---

# Runbook

## Topology

```
                     ┌──────────────── saplink-api box ─────────────────┐
  ESP32 ────────────►│  Caddy :443          FastAPI :8000               │
   (dummy data)      │  api.<domain>  ──►  /api/readings  /api/alerts   │
                     │                            │                     │
  future iOS app ───►│                       SQLite (docker volume)     │
                     └──────────────────────────────────────────────────┘
                                          ▲
                                          │ CORS: https://<domain>
                     ┌──────────────── saplink-web box ─────────────────┐
  browser ──────────►│  Caddy :443   <domain>  ──►  app/frontend/dist/  │
                     └──────────────────────────────────────────────────┘
```

| | role | host | repo path |
|---|---|---|---|
| `saplink-api` | FastAPI + SQLite + Caddy | `api.<domain>` | `/opt/saplink` |
| `saplink-web` | Caddy static file server | `<domain>`, `www.<domain>` | `/opt/saplink` |

Each box runs its own Caddy for TLS. Port 8000 is never exposed; only 80/443 are open on either box.

## Provisioning

1. Two instances: **Ubuntu 24.04, Cloud Compute – Regular, 1 vCPU / 1 GB**, region **Dallas**. Attach `~/.ssh/hackrice_deploy.pub` at create time.
2. **DNS first** — the only step with a wait in it. `A api → <API_IP>`, `A @ → <WEB_IP>`, `A www → <WEB_IP>`, lowest TTL available. Verify with `dig +short api.<domain>`.
3. Both boxes: `curl -fsSL https://get.docker.com | sh`, then `ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable`.
4. Both boxes: `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""`, add each as its own read-only GitHub deploy key (multiple keys per repo is fine; one key can't be reused across repos). Then `git clone git@github.com:Mungbeanbeanie/saplink.git /opt/saplink`.
5. `/opt/saplink/.env`, gitignored, written by hand:
   - **api box:** `SAPLINK_API_DOMAIN`, `SAPLINK_TOKEN` (random 32 hex), `SAPLINK_WEB_ORIGIN=https://<domain>,https://www.<domain>`
   - **web box:** `SAPLINK_WEB_DOMAIN`
6. Local `~/.ssh/config`: `Host saplink-api` / `Host saplink-web`, both `User root`, `IdentityFile ~/.ssh/hackrice_deploy`.

## Deploy

```sh
./deploy.sh api      # backend box
./deploy.sh web      # frontend box
./deploy.sh          # both
```

Each runs `git pull --ff-only && docker compose -f compose.<role>.yaml up -d --build` over SSH, then health-checks. Backend source is **bind-mounted**, so a Python change is a ~1 s `uvicorn --reload`; the image only rebuilds when `requirements.txt` changes. Requires `$SAPLINK_DOMAIN` exported locally.

On the boxes:

```sh
cd /opt/saplink
docker compose -f compose.api.yaml up -d --build    # or compose.web.yaml
docker compose -f compose.api.yaml logs -f caddy    # watch cert issuance
docker compose -f compose.api.yaml logs -f api      # backend logs
```

### Gotchas

- **`caddy-data` must stay a named volume.** It holds the issued cert and ACME account. Drop it and you re-issue on every restart, which trips Let's Encrypt's 5-per-week duplicate-cert limit mid-hackathon.
- **Port 80 must stay open** even though everything redirects to HTTPS — Let's Encrypt's HTTP-01 challenge uses it.
- **Cert won't issue before DNS resolves**, and a failed issuance backs off. Check `dig +short api.<domain>` first, not the Caddy logs.

## Firmware

```
esp32/Saplink/
  src/combo_main.cpp      primary: sense + upload (+ actuate, outstanding)
  src/diagnostic_main.cpp I2C hardware debugger
  src/sensor_main.cpp     (stretch, two-plant only, not built)
  src/actuator_main.cpp   (stretch, two-plant only, not built)
  include/secrets.h       GITIGNORED — copy from secrets.h.example
```

One env per `*_main.cpp`, selected by `build_src_filter` — each defines `setup()`/`loop()`, so exactly one builds at a time. `pio` is not on PATH and there is **no default env**:

```sh
alias pio=~/.platformio/penv/bin/pio
pio run -e combo -t upload && pio device monitor   # primary firmware
pio run -e diagnostic -t upload                    # the I2C scanner instead
```

Healthy monitor output: `wifi ok <ip>` then a repeating `POST 200 seq=N`.

`SAPLINK_URL` in `secrets.h` is `https://api.<domain>/api/readings`; `SAPLINK_TOKEN` must match the API box's `.env`.

### The seam

`readMv()` in `combo_main.cpp` is the **only** thing that changes when the ADS1115 is wired: replace the body with a real read and flip `SRC` to `"ads1115"`. Nothing else in the file moves. Today it returns slow baseline wander plus a spike every ~20 s, so the dashboard sees a realistic shape rather than a flat line.

`diagnostic_main.cpp` is the original I2C diagnostic — pull-up detection, pin capacitance sweep, address scan at two bus speeds. Use it the day the ADC shows up and doesn't ACK at 0x48.

### TLS

`WiFiClientSecure::setInsecure()` — cert validation is skipped. The bearer token is the real auth and TLS still stops passive sniffing. Proper pinning needs an NTP-synced clock plus ISRG Root X1, and a captive-portal Wi-Fi that blocks NTP would then kill ingestion on stage. Upgrade path is `configTime()` + `setCACert()`.

## Remaining to first green demo

- [ ] Two Vultr instances provisioned; DNS resolving
- [ ] Docker + ufw on both; repo cloned; `.env` written on each
- [ ] `https://<domain>` and `https://api.<domain>/api/health` both green, valid certs
- [ ] `curl` POST to `/api/readings` round-trips through `/api/readings/history`; bad token → 401
- [ ] `include/secrets.h` filled in with the real domain + token
- [ ] ESP32 flashed (`pio run -e combo -t upload`) → monitor shows `wifi ok` + `POST 200`
- [ ] `./deploy.sh` ships a change end to end
