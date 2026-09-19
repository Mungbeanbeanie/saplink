# Build Plan

- Checklist, worked top-to-bottom. Each item is exactly one file with a single responsibility — `stage`/`apply` should be able to touch one checklist item without needing to also change any other file. Phases are ordered by dependency (later phases consume earlier ones).

---

## Phase 1: Firmware Workspace Scaffold & Shared Primitives

- Single physical ESP32 + single ADS1115 reused across every role (diagnostic/sensor/actuator/combo) and even across multiple plants (separate ADS1115 channels, not separate ADCs) — envs, the shared alert schema, and WiFi config come first so no later file guesses at a format or credential source the others don't agree on yet.

- [x] `esp32/Saplink/platformio.ini` — extend the existing single-env file to declare `env:diagnostic`, `env:sensor`, `env:actuator`, `env:combo`, `env:native`; each of the first four sets `build_src_filter` to its own `src/<role>_main.cpp` plus shared `lib/saplink_common/**` and inherits today's `platform=espressif32`/`board=esp32dev`/`framework=arduino`/`monitor_speed=115200`. `env:native` uses PlatformIO's `platform = native` (no board, runs on the dev machine) to build and run `test/`'s Unity tests against `lib/saplink_common/**` with no ESP32/ADS1115 hardware attached — this constrains those lib files to portable C++ with no direct Arduino/ESP32-only calls. `env:combo` is the primary hardware build target; `env:sensor`/`env:actuator` are stretch-goal envs for a possible future two-plant demo.
- [x] `esp32/Saplink/src/diagnostic_main.cpp` — existing I2C bus scanner (`pulledUpExternally`, `riseCycles`, `capacitanceProbe`, `sweep`, `scan`) moved verbatim from today's `src/main.cpp`, no logic changes. Stays the permanent tool for re-verifying ADS1115 wiring (expected 0x48–0x4B) whenever probes/wiring change.
- [ ] `esp32/Saplink/lib/saplink_common/packet_schema.h` — the locked alert schema shared by firmware and backend: `node_id` (uint8_t), `event_type` (enum `VP_SPIKE`, `REPLAY_TRIGGER`), `voltage_mv` (float, the captured 0.1–100mV VP reading), `threshold_mv` (float, active detector threshold at fire time), `timestamp_ms` (uint32_t, `millis()` at capture). Now serialized as JSON over HTTPS (via ArduinoJson) rather than `memcpy`'d into an ESP-NOW payload — these field names are exactly what the backend's Pydantic model (Phase 5) must match.
- [ ] `esp32/Saplink/lib/saplink_common/secrets.h.example` — template for WiFi SSID/password + the Vultr API base URL; the real `secrets.h` is gitignored and never committed. Needed before `cloud_client` (Phase 3) can connect to anything.

---

## Phase 2: Sense Subsystem Primitives

- Pure, testable-in-isolation modules — no networking, no I/O beyond the ADC read — built before Route so signal quality can be checked before wireless/cloud complexity is added.

- [ ] `esp32/Saplink/lib/saplink_common/signal_conditioning.h/.cpp` — `class SignalConditioner`: `float update(float raw_mv)` runs a small fixed-window median filter (odd window, e.g. 5 samples), then a 60Hz notch (biquad), then subtracts a slow-adapting baseline (`baseline += (filtered - baseline) * alpha`). Exposes `float baseline() const` for serial debug logging.
- [ ] `esp32/Saplink/lib/saplink_common/peak_detector.h/.cpp` — `class PeakDetector`: `bool check(float conditioned_mv, float baseline_sigma)` classifies a candidate deflection as a real Action Potential using TommyVaninetti/PlantLeaf's documented criteria — initial deflection exceeds 3σ of the rolling baseline noise floor, and the signal's rebound back toward baseline reaches ≥30% of that initial deflection (rejects single-direction drift/noise that never rebounds). Adapted from PlantLeaf's peak-structure/rebound-ratio/3σ-threshold method rather than an arbitrary fixed threshold.
- [ ] `esp32/Saplink/lib/saplink_common/recorded_signal.h/.cpp` — `const float RECORDED_VP_WAVEFORM[]` (PROGMEM), sourced from a real reference VP spike recording — adapted from BackyardBrains Plant-SpikerBox/SpikeRecorder sample data or ETigerschuss/conduction-velocity-plants, not a synthetic/made-up shape — + `class RecordedSignalPlayer`: `void trigger()` (armed via serial command or GPIO button) and `bool nextSample(float& out_mv)`, feeding the array through the exact same `SignalConditioner`/`PeakDetector` pipeline live probes use. No longer just a failure fallback — per user, this is the primary mechanism for the single-plant demo's artificial "alert" signal ("one plant gathering and giving it signals"), and using a real captured waveform means the artificial alert is provably a realistic VP spike shape, not an invented one.
- [ ] `esp32/Saplink/test/test_signal_pipeline/test_signal_pipeline.cpp` — PlatformIO Unity test under `env:native` (Phase 1), runs on a dev machine with no ESP32/ADS1115 attached (mirrors AIislamdemir/plant-biosignal's hardware-free simulator pattern). Feeds `SignalConditioner`+`PeakDetector` two fixtures: (a) synthetic noise-only input — must NOT fire, catching false positives; (b) `recorded_signal.h`'s reference VP waveform — must fire and classify as an Action Potential. Validates the from-scratch filter/classifier logic against a known-good real plant-signal shape (sourced per BackyardBrains Plant-SpikerBox / conduction-velocity-plants) before ever depending on a live plant to prove the pipeline works.

---

## Phase 3: Route Subsystem (Cloud Transport)

- Needs `packet_schema.h` and `secrets.h` (Phase 1) before it can serialize or connect anywhere. Renamed from "Wireless Transport" — ESP-NOW is dropped; WiFi/HTTPS to the Vultr backend is the only transport now.

- [ ] `esp32/Saplink/lib/saplink_common/cloud_client.h/.cpp` — `class CloudClient`: `bool begin()` (`WiFi.begin(ssid, pass)` from `secrets.h`, blocks until connected), `bool postAlert(const PacketSchema& pkt)` (HTTPS POST JSON to `<API_BASE_URL>/api/alerts`), `bool pollPendingAlert(PacketSchema& out)` (HTTPS GET `<API_BASE_URL>/api/alerts/pending`), `bool ackAlert(int alert_id)` (HTTPS POST `<API_BASE_URL>/api/alerts/{id}/ack`). Uses `HTTPClient`/`WiFiClientSecure`, JSON (de)serialization via ArduinoJson matching `packet_schema.h`'s fields.

---

## Phase 4: Node Firmware Entry Points

- Primary target is single-plant, single-board: `combo_main.cpp` does both sense and actuate on one ESP32, since (per user) a real two-plant setup would need a second full hardware set that doesn't exist yet. `sensor_main.cpp`/`actuator_main.cpp` are stretch items for if a second plant/board becomes available — and even then, per user, both plants' probes would likely feed the same ADS1115's separate channels rather than needing a second ADS1115.

- [ ] `esp32/Saplink/src/combo_main.cpp` — **primary entrypoint.** `setup()` inits ADS1115, `SignalConditioner`, `PeakDetector`, `RecordedSignalPlayer`, `CloudClient::begin()`. `loop()`: reads the ADS1115 channel, runs it through `SignalConditioner`/`PeakDetector`; if a live threshold isn't hit, an armed `RecordedSignalPlayer` trigger substitutes an artificial alert into the same pipeline. On any fire, calls `CloudClient::postAlert()`. Every loop iteration also calls `CloudClient::pollPendingAlert()` — whether the pending alert is the one this same board just posted, or one the frontend manually injected — and on finding one, drives the relay/pump + LED/buzzer per the Actuate design, then `CloudClient::ackAlert()`s it. Demonstrates the full sense→cloud→actuate loop on one plant, one board.
- [ ] `esp32/Saplink/src/sensor_main.cpp` — (stretch — two-plant demo only) Sensing-only role: `setup()`/`loop()` as `combo_main.cpp`'s sense half, minus the poll/actuate side.
- [ ] `esp32/Saplink/src/actuator_main.cpp` — (stretch — two-plant demo only) Actuate-only role: `setup()` inits `CloudClient::begin()` and the relay/LED/buzzer GPIOs; `loop()` just polls/acks/actuates, mirroring `combo_main.cpp`'s actuate half.

---

## Phase 5: Cloud Backend (Vultr, Dockerized API + Postgres)

- Sequenced after firmware so the alert schema it exposes is already locked (Phase 1). Replaces the earlier local-JSON-capture design entirely — the ESP32 now talks straight to this backend, and the frontend (Phase 6) reads straight from it too.

- [ ] `app/backend/requirements.txt` — `fastapi`, `uvicorn`, `sqlalchemy`, `psycopg2-binary`, `pydantic`, pinned.
- [ ] `app/backend/app/models.py` — SQLAlchemy `Alert` table: `id` (serial PK), `node_id`, `event_type`, `voltage_mv`, `threshold_mv`, `timestamp_ms`, `acked` (bool, default False), `created_at` (server default now()). Mirrors `packet_schema.h`'s fields.
- [ ] `app/backend/app/schemas.py` — Pydantic request/response models matching `models.py`, used for FastAPI request validation and response serialization.
- [ ] `app/backend/app/routes.py` — `POST /api/alerts` (sensor/combo posts a new alert), `GET /api/alerts/pending` (actuator/combo polls for the oldest un-acked alert), `POST /api/alerts/{id}/ack` (marks acked), `GET /api/readings/latest`, `GET /api/readings/history` (frontend reads), `POST /api/alerts/manual` (dashboard-injected artificial alert, `event_type=REPLAY_TRIGGER`).
- [ ] `app/backend/app/main.py` — FastAPI app instance, includes `routes.py`'s router, DB session/engine setup from a `DATABASE_URL` env var.
- [ ] `app/backend/Dockerfile` — container image for the API service (Python base image, installs `requirements.txt`, runs `uvicorn app.main:app`).
- [ ] `app/backend/docker-compose.yml` — orchestrates the API container + a `postgres` container (named volume for data persistence, `DATABASE_URL` wired between them via env vars) — one command (`docker compose up`) reproduces the same stack on a fresh Vultr droplet.

---

## Phase 6: Frontend Dashboard (React, standalone)

- Last phase, consumes only Phase 5's API. Fully decoupled — no shared code with the backend beyond the schema shape, per user's "separate standalone" direction.

- [ ] `app/frontend/package.json` — Node scaffold: `react`, `react-dom`, `vite`, `tailwindcss` + PostCSS/autoprefixer peers. Replaces the current bare `index.html` placeholder with an actual buildable project.
- [ ] `app/frontend/index.html` — Vite entry HTML (`<div id="root">` + module script to `src/main.jsx`), replacing today's empty placeholder.
- [ ] `app/frontend/src/main.jsx` — `ReactDOM.createRoot(...).render(<App />)`, imports Tailwind base CSS.
- [ ] `app/frontend/src/App.jsx` — dashboard layout matching the Hackathon Demo Workflow: live baseline voltage panel(s) (from `GET /api/readings/history`), a VP-spike alert banner (from `GET /api/readings/latest`), an actuation-status indicator ("Target Network Node Primed"), and a manual replay-trigger button that calls `POST /api/alerts/manual`.
- [ ] `app/frontend/src/lib/dataFeed.js` — `useReadings()` hook: polls the Vultr API's `/api/readings/latest` and `/api/readings/history` endpoints on an interval (base URL from a Vite env var), returns current reading + rolling history array to `App.jsx`; also exposes a `postManualAlert()` call for the replay button.
