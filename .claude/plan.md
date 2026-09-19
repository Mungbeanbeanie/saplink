# Build Plan

- Checklist, worked top-to-bottom. Each item is exactly one file with a single responsibility — `stage`/`apply` should be able to touch one checklist item without needing to also change any other file. Phases are ordered by dependency (later phases consume earlier ones).
- Phases 1–4 are firmware, 5 the backend, 6 the frontend, 7 backend Google Sign-In. The **Runbook** at the bottom is the operational half: topology, deploy commands, and the gotchas that bite on demo day.

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
- `baseline_mv` / `event` — in the schema from day one so Phase 2's auto-zero and classifier land without a schema change. Firmware sends a running mean and `null` until then. (LANDED, and both fields' semantics changed with it: `baseline_mv` is now `SignalConditioner::baseline()` — the electrode's absolute standing potential — not the batch mean, because `mv[]` now carries drift-removed *deviations* whose mean is ~0 by construction and would have reported a live electrode as sitting at zero. `event` is `"spike"` when `PeakDetector` fires. Additive `soil_mv` joined the contract — raw ADC millivolts, deliberately not a calibrated moisture percentage — as `Optional` with a default, so pre-`soil_mv` firmware still validates and the contract stays frozen rather than changed. Needed an `ALTER TABLE` in the backend: `CREATE TABLE IF NOT EXISTS` will not add a column to an existing `saplink.db`.)

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

- [x] `esp32/Saplink/lib/saplink_common/signal_conditioning.h/.cpp` — `class SignalConditioner`: `float update(float raw_mv)` runs a small fixed-window median filter (odd window, 5 samples), then subtracts a slow-adapting baseline (`baseline += (filtered - baseline) * alpha`). Exposes `float baseline() const` for serial debug logging. Meant to be called from `combo_main.cpp`'s sense loop, in place of its raw `readMv()` passthrough. (60Hz notch dropped: sample rate is 10Hz, Nyquist=5Hz, notch is meaningless below Nyquist and was never viable at this rate; median filter + adaptive baseline only. Revisit only if sample rate is raised well above 120Hz.) (Review fix: `update()` was returning the raw median instead of the baseline-subtracted value -- the auto-zero subtraction described above was never actually applied, so a wandering baseline could look like a spike to `PeakDetector`. Fixed to return `filtered - baseline_`. Also added a `variance_`/`sigma()` EMA noise-floor estimator, seeded at 1.0 to avoid a near-zero 3sigma threshold before it converges -- `PeakDetector::check()`'s `baseline_sigma` param previously had no real producer anywhere in the codebase.)
- [x] `esp32/Saplink/lib/saplink_common/peak_detector.h/.cpp` — `class PeakDetector`: `bool check(float conditioned_mv, float baseline_sigma)` classifies a candidate deflection as a real Action Potential using TommyVaninetti/PlantLeaf's documented criteria — initial deflection exceeds 3σ of the rolling baseline noise floor, and the signal's rebound back toward baseline reaches ≥30% of that initial deflection (rejects single-direction drift/noise that never rebounds). Output maps directly to Contract A's `event` field — `check()` returning true means the batch currently being built should send `event:"spike"` instead of `null`. (The "moves to the backend as a Python port" divergence noted here previously is **WITHDRAWN** — it was never built and is not scheduled. Classification runs on-device, wired into `combo_main.cpp`'s live sense loop: the board is the only place `3*sigma` and the fired peak exist, since neither is in Contract A, so a backend port could only have re-estimated them from `mv[]`. See Phase 4's `combo_main.cpp` line.) (GAINED `lastPeak()`/`lastThreshold()`, published just before `peak_mv_` is cleared on fire. A deflection is tracked ACROSS batches, so a caller scanning only the current 32-sample batch misses the real peak whenever a VP straddles the boundary — on hardware that reported `voltage_mv` 4.128 against a `threshold_mv` of 4.964, a voltage that had supposedly cleared a higher bar. `threshold_mv_` is captured when the deflection latches, not when the rebound confirms, since sigma drifts between those samples. Regression test: `test_peak_reported_when_vp_straddles_batch_boundary`, which also asserts the fixture genuinely straddles a boundary so it cannot silently stop testing anything.)
- [x] `esp32/Saplink/lib/saplink_common/recorded_signal.h/.cpp` — `const float RECORDED_VP_WAVEFORM[]` (PROGMEM), sourced from a real reference VP spike recording — adapted from BackyardBrains Plant-SpikerBox/SpikeRecorder sample data or ETigerschuss/conduction-velocity-plants, not a synthetic/made-up shape — + `class RecordedSignalPlayer`: `void trigger()` (armed via serial command or GPIO button) and `bool nextSample(float& out_mv)`, feeding the array through the same `SignalConditioner`/`PeakDetector` pipeline live probes use. This is the primary mechanism for the single-plant demo's artificial "alert" signal, invoked from `combo_main.cpp`'s loop to synthesize a spike batch on demand. (SYNTHETIC placeholder, not a real recording: real ETigerschuss/BackyardBrains raw WAVs are gitignored in that repo and hosted on FigShare, no direct link found in this pass. Alpha-function pulse approximating VP timescale/amplitude. Revisit: swap in a real recorded waveform once the FigShare dataset is located.)
- [x] `esp32/Saplink/test/test_signal_pipeline/test_signal_pipeline.cpp` — PlatformIO Unity test under `env:native` (Phase 1), runs on a dev machine with no ESP32/ADS1115 attached. Feeds `SignalConditioner`+`PeakDetector` two fixtures: (a) synthetic noise-only input — must NOT fire, catching false positives; (b) `recorded_signal.h`'s reference VP waveform — must fire and classify as an Action Potential. Validates the from-scratch filter/classifier logic against a known-good real plant-signal shape before ever depending on a live plant.

---

## Phase 3: Route Subsystem (Cloud Transport)

- Needs `packet_schema.h` and `secrets.h` (Phase 1) before it can serialize or connect anywhere. Renamed from "Wireless Transport" — ESP-NOW is dropped; WiFi/HTTPS to the Vultr backend is the only transport now.

- [x] `esp32/Saplink/lib/saplink_common/cloud_client.h/.cpp` — `class CloudClient`: `bool begin()` (`WiFi.begin(ssid, pass)` from `secrets.h`, blocks until connected), `bool postAlert(const PacketSchema& pkt)` (HTTPS POST JSON to `${SAPLINK_API_BASE}/api/alerts`), `bool pollPendingAlert(PacketSchema& out, int& alert_id)` (HTTPS GET `${SAPLINK_API_BASE}/api/alerts/pending`), `bool ackAlert(int alert_id)` (HTTPS POST `${SAPLINK_API_BASE}/api/alerts/{id}/ack`). (The readings half — WiFi connect + HTTPS POST of Contract **A** — already exists inline in `combo_main.cpp` using `snprintf`, no ArduinoJson. Extract into this class when the alert half is written, or leave it inline if that stays simpler.) (DIVERGES from the signature above: `pollPendingAlert` gained an `int& alert_id` out-param not in the original plan text. `PacketSchema` is Contract B's wire payload only — it has no row-id field — so without this, `ackAlert()` would have nothing to ack. Also: `secrets.h.example` (Phase 1) gained one additive `SAPLINK_API_BASE` constant, since it previously only had the full `/api/readings` URL and no base for alert routes to hang off of. And: `pollPendingAlert`'s response-body parsing assumes an unlocked JSON shape — `GET /api/alerts/pending` doesn't exist on the backend yet (Phase 5) — so this must be reconciled once that route is actually designed, not treated as settled.)

---

## Phase 4: Node Firmware Entry Points

- Single-board, but **two plants**: `combo_main.cpp` senses plant 1 and actuates onto plant 2 from the same ESP32. Plant 2 needs a pot and the pump's output tube, not a second board or a second ADS1115 — so the two-plant demo is not blocked on hardware, contrary to `overview.md`. `sensor_main.cpp`/`actuator_main.cpp` below remain stretch items for splitting the roles across a *dedicated* second board.
- The cloud is a **mailbox, not a dispatcher**. The ESP32 is behind NAT with no public address, so the server can never initiate; the board opens every connection and polls `GET /api/alerts/pending` each loop (~4.6s, since the HTTP calls stretch the nominal 3.2s batch). Data still flows both ways — that poll's *response body* is the command coming down. Bounded latency is the only cost. If it ever matters on stage, the upgrade is a held-open connection (long-poll/WebSocket/MQTT), still board-initiated, still NAT-safe.
- The board never actuates on its own detection; it actuates on an alert the backend hands back. That indirection is the point — it is what makes this a routed network rather than a local `if` statement.

- [x] `esp32/Saplink/src/combo_main.cpp` — **primary entrypoint, complete in firmware.** Full loop closed and verified end to end against the live API on 2026-09-19: a real plant poke produced 3 alerts in 24s, each round-tripping plant 1 → cloud SQLite → back to the same board → ack. Landed: real ADS1115 A2-A3 read at GAIN_FOUR (`src="ads1115"`, synthetic trace kept only as the `ads.begin()` fallback); `SignalConditioner` + `PeakDetector` in the sample loop; `RecordedSignalPlayer` on serial `r`; `postAlert` of Contract B on a fire; poll → ack → `actuate()` driving the GPIO26 relay.
  - **DIVERGES — classification stayed ON-DEVICE.** The note previously here (and on Phase 2's `peak_detector` line and Phase 5's alert line) said live classification would move to the backend as a Python port. It did not, and that plan is withdrawn: the board already runs `SignalConditioner`+`PeakDetector` per sample, so the detector has `3*sigma` and the true peak at fire time — values that exist nowhere in Contract A and that a backend port could therefore only have guessed at. `PeakDetector` is now wired into the live sense loop, and no Python port exists or is scheduled.
  - **DIVERGES — ingestion is event-driven, not a continuous stream.** A quiet plant uploads nothing. A fire sends the *previous* batch (held in RAM as pre-trigger context — the VP onset is already past by the time the rebound confirms), the spiking batch, and the following one as the tail: ~9.6s of waveform per event. `kHeartbeatMs`=60000 sends one batch a minute otherwise, purely so `/api/health`'s `last_recv` doesn't report a working board as offline; set to 0 for true silence. Consequence: the dashboard chart is empty between events, which changes Demo Workflow step 1 ("show Plant A's live baseline").
  - **DIVERGES — the pump is in PLANT 2, not plant 1.** Electrodes read plant 1, the pump's output tube waters plant 2. This delivers the *two-plant* demo on one board — `overview.md` still files that as a stretch goal blocked on "a second full hardware set", which is wrong; only the tube has to move. It also means there is no sense→actuate feedback path, so no actuation-refractory window is needed; `kMinActuateGapMs`=30000 exists only to protect the reservoir.
  - Contract A gained two additive `Optional` fields, same pattern `soil_mv` proved: `replay` (bool — `src` stays `"ads1115"` on an injected VP because the ADC really is live, so without a flag it is indistinguishable from a real one) and `raw_mv` (pre-conditioning ADC array — **not** recoverable from `mv[]`, since `deviation() = filtered - baseline` means `baseline_mv + mv[i]` reconstructs the median-*filtered* value; kept so a bad conditioning choice is re-derivable without re-running the experiment). `post()`'s buffer went 1024→2048 for the second array.
  - Ack happens BEFORE actuating: a failed ack then costs a missed dose, not a repeated one. A cooldown-suppressed actuation still acks, or the backend's dedupe keeps re-serving an alert nobody will act on and `/api/alerts/pending` wedges.
  - Safety: `pinMode`/`digitalWrite(RELAY_OFF)` are the first two statements of `setup()`, before `Serial.begin` — `relayoff_main.cpp` measured a floating GPIO26 at 1482mV, which an active-HIGH module reads as ON. Safe means *driven* off.
  - **OUTSTANDING — the pump does not physically fire.** Not a firmware defect: the server logged `POST /api/alerts` 200, `GET /pending` 200, `POST /{id}/ack` 200, `last_actuate_ms` was 0 so the cooldown branch was unreachable, `seq` continued across the actuation (no brownout reset), and the relay constants are byte-identical to the bench-proven `pump_main.cpp`. So GPIO26 was driven HIGH and the relay did not act. Leading hypothesis: 5V rail contention — `pump_main.cpp` runs with the radio off and the full USB budget available, `combo` does not. `actuate()` now prints a `digitalRead()` readback to separate "pin never went high" from "pin went high, relay ignored it". Next step is hardware (separate supply for the pump, common ground), not code.

---

## Phase 5: Cloud Backend (Vultr, Dockerized API + SQLite)

- Sequenced after firmware so the alert schema it exposes is already locked (Phase 1). Replaces the earlier local-JSON-capture design entirely — the ESP32 now talks straight to this backend, and the frontend (Phase 6) reads straight from it too.
- **Two Vultr boxes, not one** — backend and frontend are separate instances so the API stays standalone and a future iOS app is just another client. Cost: they are no longer same-origin, so CORS is mandatory.

- [x] `app/backend/requirements.txt` — `fastapi`, `uvicorn[standard]`, `httpx` (TestClient only). (No `sqlalchemy`/`psycopg2-binary` — SQLite via stdlib `sqlite3`; `pydantic` comes with fastapi. Unpinned; pin if a deploy ever breaks on a new release.)
- [x] `app/backend/main.py` — single-file FastAPI app: `Batch` Pydantic model (contract **A**), stdlib `sqlite3` with WAL, `CORSMiddleware` from `SAPLINK_WEB_ORIGIN`, bearer-token auth via `hmac.compare_digest`, and the `/api/readings*` + `/api/health` routes. (Collapses the original `app/{models,schemas,routes,main}.py` split into one file — no ORM, one table, ~130 lines. Split back out if the alert plane makes it unwieldy.)
- [ ] alert control plane — `POST /api/alerts`, `GET /api/alerts/pending`, `POST /api/alerts/{id}/ack`, `POST /api/alerts/manual` (dashboard-injected artificial alert, `event_type=REPLAY_TRIGGER`). Contract **B**: needs an `acked` flag and an oldest-un-acked query. Add to `main.py`, or split to `routes.py` if it grows. **This is the gap blocking `combo_main.cpp`'s actuate half (Phase 4).** Also owns live classification now: ports Phase 2's `PeakDetector` 3σ+rebound-ratio algorithm to Python, run inside `POST /api/readings` against each batch's `mv[]` using a running per-device EMA baseline+sigma (mirrors `SignalConditioner`'s math); a fire inserts a pending Contract B alert row for `GET /api/alerts/pending` to serve. (DIVERGES from firmware-side classification originally sketched in Phase 2 — see that phase's `peak_detector.h/.cpp` line for rationale.)
- [x] `app/backend/test_ingest.py` — self-running asserts (`python test_ingest.py`; pytest optional): POST round-trips through history, bad token → 401, out-of-range → 422, `/api/readings/latest` returns the right sample.
- [x] `app/backend/Dockerfile` — `python:3.12-slim`, installs `requirements.txt` only; source arrives via bind mount so code changes need no rebuild.
- [x] `compose.api.yaml` / `compose.web.yaml` + `Caddyfile.api` / `Caddyfile.web` / `deploy.sh` at repo root — one compose file per box role, each with its own Caddy for automatic TLS. (Replaces the single `app/backend/docker-compose.yml`; no postgres container.)
- [x] Both Vultr instances provisioned, DNS pointed, `.env` written, first `docker compose up` green — see [Runbook > Remaining to first green demo](#remaining-to-first-green-demo) for the full infra checklist. (Web box now serves `app/frontend/` directly via Caddy — see Phase 6; no Vite build needed.)

---

## Phase 6: Frontend Dashboard (vanilla JS, standalone)

- Consumes only Phase 5's API (readings today; `/api/alerts/manual` once Phase 5 lands it). Fully decoupled — no shared code with the backend beyond the schema shape.
- **DIVERGES from the originally-planned React/Vite/Tailwind SPA** (that plan's checklist is kept below for history). The frontend was imported already-built as a vanilla, hash-routed multi-page JS app — rebuilding an already-complete, already-designed site in React would be pure churn with no functional benefit. No build step, no npm, no node on the host.
- Served from the `saplink-web` box. Caddy serves `app/frontend/` directly (see `compose.web.yaml`/`Caddyfile.web`) — no `dist/`, no build stage.

- [x] `app/frontend/index.html` — shell markup: `#header-slot`/`#view` mount points, script tags in load order (art + config, then one file per page, then the router).
- [x] `app/frontend/js/config.js` — `Saplink.config` (`apiBase`, `scene`, `roster`, `probes`) and `Saplink.api(path, opts)`, the one fetch helper every page uses.
- [x] `app/frontend/js/app.js` — hash router + shell: sign-in state (local-only today, see gap below), header/nav render, route table (`#/`, `#/how-it-works`, `#/dashboard`, `#/account`).
- [x] `app/frontend/js/store.js` — signal-history persistence: localStorage always, plus an artifact-hosted shared DB when available; feeds the dashboard's chart and CSV/JSON export.
- [x] `app/frontend/js/svg.js` — extracted inline art (logo, Google button icon, landing-page diagrams).
- [x] `app/frontend/js/pages/{landing,how,dashboard,account}.js` — one file per route. `dashboard.js` is the only one that talks to the live API (`/api/health`, `/api/readings/history`, `/api/alerts/manual`); the rest are static or `/api/health`-only.
- [x] `app/frontend/css/{organic,site}.css` — styling, unchanged from import.

**Wiring fix applied** (the frontend was imported already-built but not actually connected to the live backend): `config.js`'s `apiBase` was `''` (same-origin), which 404s given `saplink-web`/`saplink-api` are separate domains — set to `https://api.saplink.us`. `dashboard.js`'s `ingest()` read `d.readings`/`r.id`/`r.timestamp_ms`, none of which `main.py` returns (`{last_id, samples:[{batch_id,...,t_ms,...}]}`) — silently zero rows every poll, no error, so the chart never updated even against a healthy API. Fixed to read `d.samples`, use the response's `last_id` for polling continuity, and `r.t_ms`. `main.py` gained a `seq` field in `/api/readings/history`'s per-sample output (additive, mirrors how `soil_mv` already rides along) so the dashboard's existing dropped-batch completeness feature has real data. `compose.web.yaml`/`Caddyfile.web` dropped the Vite `build` service and now point Caddy straight at `app/frontend/`.

**Known gaps, deliberately not fixed in this pass:**
- No `threshold_mv` exists anywhere in Contract A — the dashboard's spike detail falls back to a hardcoded 70mV. Real per-event thresholds need Phase 5's backend classifier to exist and publish one.

**Sign-in wiring (built):** the frontend's "Sign in" now uses real Google Identity Services (`app/frontend/js/auth.js`, new file) instead of a `localStorage` flag — it calls the backend's already-built `GET /api/auth/me` (Phase 7) to get the server-verified email, and renders Google's own button (reliability over a custom button driving `prompt()`) in the header, landing hero, and landing join section. The account page now shows the real signed-in email instead of a fabricated fixture person (no role/join-date shown — no real source for those exists, Phase 7 has no users table). The replay button (`POST /api/alerts/manual`) now sends `Authorization: Bearer <id token>` too — still 404-gracefully today since that route is Phase 5 and unbuilt, but ready for when Phase 7's `_google_user` gets hung off it, as already noted there. **Operational requirement, not something that can be filled in from here:** `js/config.js`'s `googleClientId` ships as a placeholder (`REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID`) — must be set to the same real OAuth Web Client ID as the api box's `GOOGLE_CLIENT_ID` .env value (see Phase 7's Gotchas for how to create one). Until then, sign-in buttons don't render and everything no-ops rather than crashing.

**Follow-up wiring:** `dashboard.js`'s "Conditions" card had four hardcoded fake values. Soil moisture now shows the real (uncalibrated) `soil_mv` reading, in raw mV — already flowed through `/api/readings/history` since the Phase 7 work, just unused by the frontend until now; labeled "raw" rather than shown as a fake `%` since a true moisture percentage needs a two-point probe calibration not present in the wire format. **OPEN DECISION, not built:** Air humidity/Air temperature/Light level remain hardcoded placeholders — no sensor exists for any of the three today (outside the current BOM). Humidity/temp could plausibly come from an external weather API keyed by each router's location, but `roster` today only has SVG map x/y pixel coordinates, not real lat/lon. Light level (lux) has no weather-API equivalent at all — that one needs an actual light sensor regardless of any API integration.

Superseded original plan (React/Vite/Tailwind SPA, kept for history, not being built):
- ~~`app/frontend/package.json` — Node scaffold: `react`, `react-dom`, `vite`, `tailwindcss` + PostCSS/autoprefixer peers.~~
- ~~`app/frontend/src/main.jsx` — `ReactDOM.createRoot(...).render(<App />)`.~~
- ~~`app/frontend/src/App.jsx` — dashboard layout: live baseline panel(s), a VP-spike alert banner, an actuation-status indicator, a manual replay-trigger button.~~
- ~~`app/frontend/src/lib/dataFeed.js` — `useReadings()` hook polling `/api/readings/latest`/`/api/readings/history`.~~

---

## Phase 7: Google Sign-In (backend)

- Consumes Phase 5's `main.py`; placed last so no earlier phase's numbering moves. **Backend half only** — the Google Identity Services button that mints the ID token is a Phase 6 `App.jsx` concern and is *not* in this phase.
- **No OAuth code flow, no users table, no server sessions, no cookies, no JWT of our own.** The browser gets a Google ID token (a JWT) from GIS and sends it as `Authorization: Bearer <id_token>`; the backend verifies the signature per request and reads `email` out of it. That is the entire mechanism.
- **Separate from the device token.** The ESP32's `SAPLINK_TOKEN` path (`_auth()` on `POST /api/readings`) is untouched — two different callers, two different credentials, do not merge the checks.
- **What gets gated:** browser-initiated *writes* only — `POST /api/alerts/manual` (Phase 5's alert plane). `GET /api/readings/*` and `/api/health` stay public so the live chart can never die on stage behind an auth failure. Revisit if the dashboard is ever exposed to people who shouldn't see the stream.

- [x] `app/backend/requirements.txt` gains `google-auth` — brings `google.oauth2.id_token.verify_oauth2_token`, which does signature verification, `aud`/`iss` checks, expiry, and Google's cert fetch+cache in one call. (Not `authlib`/`google-auth-oauthlib`/`python-jose` — those are for the redirect-based code flow, which is not being used. Unpinned, matching the rest of the file.) (DIVERGES: shipped as `google-auth[requests]`, not bare `google-auth` — `google.auth.transport.requests` hard-imports `requests`, which this project doesn't otherwise have (httpx only), so bare would ImportError at first verify. The extra also pulls `urllib3`/`certifi`. No revisit needed.)
- [x] `app/backend/main.py` — three additions, all in the existing file: (1) `GOOGLE_CLIENT_ID` + `SAPLINK_ALLOWED_EMAILS` read from env at module top, next to `TOKEN`; (2) `_google_user(authorization)` — strips `Bearer `, calls `id_token.verify_oauth2_token(tok, google.auth.transport.requests.Request(), GOOGLE_CLIENT_ID)`, raises 401 on `ValueError`, raises 403 if `SAPLINK_ALLOWED_EMAILS` is non-empty and the token's `email` isn't in it, returns the email; (3) `GET /api/auth/me` → `{"email": ...}`, so the frontend can validate a token once and render "signed in as X". Then hang `_google_user` off `POST /api/alerts/manual` when that route lands. (Empty `SAPLINK_ALLOWED_EMAILS` = any Google account passes — fine for a demo, it still proves a real identity. Set it to the team's addresses before the dashboard is shared.) (DIVERGES on two points. (a) A **fourth file** was needed, not listed in this phase: `compose.api.yaml`'s `api` service had to pass `GOOGLE_CLIENT_ID`/`SAPLINK_ALLOWED_EMAILS` through, or the container never sees them. Wired with soft `${VAR:-}` defaults, deliberately *not* the `:?` form the other vars use, so a `git pull` landing before `.env` is edited can't refuse to start the currently-green stack. (b) `_google_user` gained two guards beyond the text: an upfront 503 if `GOOGLE_CLIENT_ID` is unset, and a 503 on non-`ValueError` exceptions, so a Google cert-fetch/transport failure isn't reported to the user as "your token is bad". Nothing is gated by it yet — `POST /api/alerts/manual` still doesn't exist.)
- [x] `app/backend/test_ingest.py` gains two asserts — garbage token → 401, and `/api/readings/history` still answers with no `Authorization` header at all (guards against accidentally gating reads). Verifying a *real* token in a test would need a live Google round-trip; skipped, monkeypatch `verify_oauth2_token` only if the happy path ever regresses. (NOTE: `test_google_garbage_token` **needs network** — google-auth fetches Google's certs before parsing, so offline it gets the 503 transport branch instead of 401 and fails. Monkeypatch if that ever becomes annoying in CI. All 6 tests green as of 2026-09-19.)

Gotchas, in the order they bite:
- **`GOOGLE_CLIENT_ID` must be the Web application OAuth client**, created at console.cloud.google.com → APIs & Services → Credentials, with `https://saplink.us` and `https://www.saplink.us` under *Authorized JavaScript origins*. No redirect URI is needed — GIS uses the origin. Same client id on both the frontend button and the backend `aud` check, or every token fails verification.
- **Google ID tokens expire in ~1 hour.** No refresh handling is planned; GIS re-prompts and the frontend just sends the new one.
- **`allow_headers=["*"]` in the existing CORS block already permits `Authorization`** — no CORS change needed. The web origins list already covers both `saplink.us` and `www.`.
- **The API box's clock matters** — JWT `exp`/`iat` validation fails on a drifted clock. Vultr's Ubuntu image runs `systemd-timesyncd` by default; check `timedatectl` if verification mysteriously 401s.

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

| | role | host | IP | repo path |
|---|---|---|---|---|
| `saplink-api` | FastAPI + SQLite + Caddy | `api.saplink.us` | `64.177.47.93` | `/opt/saplink` |
| `saplink-web` | Caddy static file server | `saplink.us`, `www.saplink.us` | `45.32.211.54` | `/opt/saplink` |

Each box runs its own Caddy for TLS. Port 8000 is never exposed; only 80/443 are open on either box.

Domain is `saplink.us` at **Porkbun**. Its default wildcard `CNAME *.saplink.us → pixie.porkbun.com` is left in place — exact-match A records win over a wildcard, so it never shadows `api.`/`www.`.

## Provisioning

**Both boxes are provisioned and green** (2026-09-19); steps below are the rebuild recipe. Actuals differ from the original plan where noted.

1. Two instances: **Cloud Compute – Regular, 1 vCPU / 1 GB**, region **Dallas**. Attach `~/.ssh/hackrice_deploy.pub` at create time. (Built on **Ubuntu 26.04**, not 24.04 — Docker's convenience script handles it fine: Docker 29.8.1 / Compose v5.5.1.)
2. **DNS first** — the only step with a wait in it. `A api → <API_IP>`, `A @ → <WEB_IP>`, `A www → <WEB_IP>`, lowest TTL available. Verify with `dig +short api.saplink.us`.
3. Both boxes: `curl -fsSL https://get.docker.com | sh`, then `ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable`. Also `fallocate -l 1G /swapfile` + `mkswap`/`swapon` + an `/etc/fstab` line — 1 GB RAM with no swap OOM-kills the Phase 6 node build.
4. Both boxes: `git clone https://github.com/Mungbeanbeanie/saplink.git /opt/saplink`. (The repo is **public**, so no GitHub deploy keys are needed. If it ever goes private: `ssh-keygen -t ed25519` per box, each pubkey added as its own read-only deploy key — multiple keys per repo is fine; one key can't be reused across repos.)
5. `/opt/saplink/.env`, gitignored, `chmod 600`:
   - **api box:** `SAPLINK_API_DOMAIN=api.saplink.us`, `SAPLINK_TOKEN` (`openssl rand -hex 32`), `SAPLINK_WEB_ORIGIN=https://saplink.us,https://www.saplink.us`, and (Phase 7, landed) `GOOGLE_CLIENT_ID` (+ optional `SAPLINK_ALLOWED_EMAILS`, CSV; empty = any Google account). Both are soft-defaulted in `compose.api.yaml`, so an unset `GOOGLE_CLIENT_ID` 503s `/api/auth/me` only and leaves ingestion running
   - **web box:** `SAPLINK_WEB_DOMAIN=saplink.us`
6. Local `~/.ssh/config`: `Host saplink-api` / `Host saplink-web`, both `User root`, `IdentityFile ~/.ssh/hackrice_deploy`. Required by `deploy.sh`, which addresses the boxes only by those nicknames.

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

- [x] Two Vultr instances provisioned; DNS resolving
- [x] Docker + ufw on both; repo cloned; `.env` written on each
- [x] `https://saplink.us` and `https://api.saplink.us/api/health` both green, valid certs (Let's Encrypt, expire 2026-12-18)
- [x] `curl` POST to `/api/readings` round-trips through `/api/readings/history`; bad token → 401
- [x] `include/secrets.h` filled in with the real domain + token (Wi-Fi SSID/pass still placeholder — fill at the venue)
- [ ] ESP32 flashed (`pio run -e combo -t upload`) → monitor shows `wifi ok` + `POST 200`
- [x] `./deploy.sh api` ships a change end to end. `./deploy.sh web` now works too — `compose.web.yaml` dropped the Vite `build` service (the frontend has no npm project), Caddy serves `app/frontend/` directly.

Body validation runs *before* the token check (FastAPI parses the body during dependency solving, and auth is an inline header param in the handler), so a malformed body returns 422 even with no token. Only the schema shape leaks; writes still require the token. Move auth to a `Depends()` if that ordering ever matters.
