## Purpose

Old-growth "mother trees" act as hubs in a forest's mycorrhizal (fungal) network — sensing stress in nearby trees/seedlings and routing water, nutrients, and defense signals to support them. Deforestation and intensive logging remove these hub trees, cutting seedlings off from that support network.

This project is a synthetic stand-in for that lost relay function: an electronic system that senses stress in one plant and routes a support response to another. The primary proof-of-concept demonstrates that sense→route→actuate mechanism on a single plant — reading it, then triggering its own support response from an artificial "alert" signal standing in for a second plant's stress — since a full two-plant setup needs hardware not yet in hand. The two-plant version, one plant's real stress signal routed to support a separate plant, is the target vision once that hardware exists.

## System Overview

The cloud hub is live today on two Vultr instances: `saplink-api` (Caddy terminating TLS, reverse-proxying to a FastAPI app backed by SQLite) and `saplink-web` (Caddy serving a static dashboard, no build step). An ESP32 running `combo_main.cpp` joins WiFi, batches voltage samples, and POSTs them over HTTPS to `saplink-api`'s `/api/readings` endpoint, authenticated with a bearer token; the dashboard on `saplink-web` polls `saplink-api`'s `/api/readings/history` and `/api/readings/latest` endpoints directly from the browser (CORS-allowed, no auth needed for reads). This sense→cloud half of the loop works today — the ADS1115 is wired and `src` reports `"ads1115"`, with the synthetic wander+spike trace kept only as a fallback when `ads.begin()` fails. (Route names and the firmware file above were stale: they described `sensor_main.cpp` POSTing to `/ingest` with reads on `/samples` and `/events`, none of which exist. The seam is `readMv()` in `combo_main.cpp`; it previously pointed at `esp32/Saplink/CLAUDE.md`, deleted in `29a6dc5`.)

The actuate half — routing a sensed stress signal into an actual support response, on the same plant (primary) or a second plant (stretch) — is not yet built. `combo_main.cpp` (primary target: one board, sense and actuate on the same plant) and `actuator_main.cpp` (stretch: a second board/plant) both remain to-do, and the backend itself has no pending-actuation state yet for either one to poll — that's an open design gap, not just an unwritten file. Closing that loop, even in its single-plant loopback form, is the next milestone toward the mother-tree replacement vision; today's system proves the sense→cloud ingestion half of it.

## End-to-End System Architecture

**Primary Demo Architecture (working today: sense → cloud ingestion):**

```
Plant A ──► ┌────────────────────────────┐   WiFi/HTTPS POST /ingest    ┌──────────────────────────────────┐
 (no ADS1115 │ sensor_main.cpp (ESP32)    │  Bearer SAPLINK_TOKEN         │ saplink-api box (Vultr)           │
  wired yet;  │ • readMv(): synthetic      │  {device,seq,t_ms,period_ms,  │ Caddy :443 → FastAPI :8000         │
  "the seam"  │   wander+spike ("sim")     │   baseline_mv,event,src,mv[]} │ → SQLite (batch table, WAL)       │
  swaps this  │ • batches 32 samples@10Hz  │──────────────────────────────►│                                    │
  for a real  │ • WiFi STA + HTTPS POST    │                                └────────────────┬───────────────────┘
  read later) └────────────────────────────┘                                                 │ WiFi/HTTPS GET (browser polls, not the ESP32)
                                                                                               ▼
                                                                             ┌──────────────────────────────────┐
                                                                             │ saplink-web box (Vultr)            │
                                                                             │ Caddy static file server            │
                                                                             │ serves app/frontend/ (config.js →   │
                                                                             │ window.SAPLINK_API; index.html TODO)│
                                                                             │ browser fetches /samples + /events  │
                                                                             │ straight from saplink-api (CORS)    │
                                                                             └──────────────────────────────────┘
```

**NOT YET BUILT:** an actuate return path back onto Plant A. `combo_main.cpp` (relay/pump/LED response) and a pending-actuation mechanism on `saplink-api` (no ack/pending state exists in the backend today) are both still open work — see `plan.md` Phase 4/5.

**Target Architecture (Two-Plant, Stretch Goal — conceptual, unbuilt):**

```
                    [ CONTROL ZONE ]
                 Control Plant Baseline
                          │
                          ▼
                ┌───────────────────┐
                │ Reference Probes  │
                └─────────┬─────────┘
                          │
                          ▼
[ ORIGIN ZONE ]      [ SENSE ]                                [ CLOUD HUB — 2 Vultr boxes, Caddy + SQLite ]                [ ACTUATE — not yet built ]
Plant A (Origin) ──► ┌───────────────────────────┐   HTTPS POST /ingest   ┌───────────────────────────────┐   HTTPS GET (poll)   ┌───────────────────────────┐ ──► Primary: Peristaltic Pump
  • Stressed         │ Sensing Node              │ ──────────────────────►│ saplink-api: FastAPI + SQLite  │ ─────────────────────►│ Actuator Node             │     • Defense Priming Proxy
  • Chlorided Ag Wire│ • ESP32 + ADS1115         │                        │ (batches, spike events)        │  no pending mechanism  │ • ESP32 + 5V Relay        │     • Resource Lifeline (N-P-K)
   Probes in Stem/Soil│ • Median/Notch + Auto-Zero│                       └────────────────┬────────────────┘  exists yet — gap      └─────────────┬─────────────┘ ──► Fallback: LED & Buzzer
                     └─────────────┬─────────────┘                                         │ HTTPS GET                                              │                   • Visual "Primed" State
                                   │                                                        ▼                                                        ▲
                     ┌───────────────────────────┐                            ┌───────────────────────────┐                                         │
                     │ Recorded Signal Fallback  │ ── local pipeline ────────►│ saplink-web: static dashboard│                                        │
                     │ (Pre-recorded VP Replay)  │   also: manual "inject     │ polls /samples + /events    │────────────────────────────────────────┘
                     │   (Phase 2, not built)    │    alert" (undesigned) ────►│ directly from saplink-api   │  (manual replay trigger, once it exists,
                     └───────────────────────────┘                            └───────────────────────────┘   would reach the actuator the same way)
```

**Demo Timing Note:** Real bioelectric responses propagate over tens of seconds to minutes. The live demonstration narrates through this latency window rather than expecting instant plant physics — the added WiFi/HTTP round-trip to the cloud is well under a second and isn't a limiting factor next to that. A pre-recorded signal replay path (Phase 2's `RecordedSignalPlayer`, not yet built) is meant to act as an instant fallback if the live plant remains dormant on stage.

## Detailed Subsystem Breakdown

**Primary vs. stretch:** `sensor_main.cpp` already implements the primary build's sense half on its own. `combo_main.cpp` — sense *and* actuate on one board/plant — is the real primary target for a demoable full loop, and is still unwritten. The separate Sensing Node / Actuator Node split described below is the two-plant stretch goal.

### 1. Sense Subsystem (Inbound Data)
- **Probe Interface:** 18-gauge fine silver wire electrodes, chlorided via brief electrolysis or a diluted-bleach dip to minimize noise relative to raw silver. Two probe pairs: one in the stem base/tissue, one in rhizosphere soil. Not yet wired — `sensor_main.cpp` sends synthetic data in the meantime.
- **Reference Placement:** Includes a third control-plant reference probe pair operating simultaneously to demonstrate that signal triggers are distinct from ambient electrical or thermal noise. Not yet wired.
- **Signal Capture:** ADS1115 16-bit differential ADC reading 0.1–100 mV Variation Potentials (VPs) and Action Potentials (APs) — planned; today's placeholder is `readMv()`'s synthetic wander-plus-spike.
- **Signal Conditioning:** Planned (Phase 2, not yet built): digital median filter and 60 Hz notch filter on the ESP32 to eliminate AC mains hum, paired with a rolling baseline/auto-zero algorithm. Today's firmware sends raw (synthetic) values with no conditioning pipeline.
- **Cloud Uplink:** Working today. `sensor_main.cpp` joins WiFi (STA mode, credentials from `include/secrets.h`), batches 32 samples at a 100ms period (~10Hz, one POST every ~3.2s), and POSTs the batch as hand-built JSON to `saplink-api`'s `/ingest` endpoint over HTTPS, authenticated with `Authorization: Bearer <SAPLINK_TOKEN>`. No ESP-NOW/LoRa pairing, no shared client library — WiFi connect and POST logic live directly in `sensor_main.cpp`.

### 2. Route Subsystem (Cloud Data Plane)
- **Edge Classifier:** Not yet built. The wire schema reserves an `event` field (`null` or `"spike"`) for this; `sensor_main.cpp` always sends `event:null` today. Phase 2's `PeakDetector` (3σ-threshold + ≥30% rebound-ratio, from PlantLeaf's method) is the planned implementation, meant to be wired into `combo_main.cpp`.
- **Cloud Backend:** Two independent Vultr instances. `saplink-api`: Caddy auto-issues a Let's Encrypt cert and reverse-proxies to a single-file FastAPI app (`app/backend/main.py`) backed by SQLite (stdlib `sqlite3`, WAL mode, one `batch` table with the sample array stored as a JSON text column). `saplink-web`: Caddy serving `app/frontend/`'s static files directly, no build step. Each box runs its own `docker compose` stack (`compose.api.yaml` / `compose.web.yaml`, both at the repo root); `deploy.sh` ships changes via `ssh` + `git pull --ff-only` + `docker compose up -d --build`, then health-checks the result.
- **Actuator Poll:** **Not yet built.** No pending-actuation mechanism (ack/acted state) exists in the backend at all — this is an open gap that must be designed before `combo_main.cpp` (primary) or `actuator_main.cpp` (stretch) has anything to poll.

- **Interface Schema:** The frozen wire format — one POST covers a batch of samples, not a single alert: `device` (str, ≤32 chars), `seq` (int ≥0, monotonic per boot — gaps mean dropped batches), `t_ms` (int ≥0, `millis()` at the *first* sample in the batch), `period_ms` (int, 1–60000), `baseline_mv` (float, −5000..5000mV), `event` (`null` or `"spike"`), `src` (`"sim"` or `"ads1115"` — how live data is told apart from synthetic on stage), `mv` (array of ≤256 floats, each −5000..5000mV). **This section is the canonical doc** — update here first to avoid the same fields drifting across three descriptions. (Previously cited `esp32/Saplink/CLAUDE.md`'s "frozen wire format" section, which was deleted in `29a6dc5` while four docs still pointed at it as authoritative; the field list above is what survived of it.)

### 3. Actuate Subsystem (Outbound Response)
- **Trigger Mechanics:** **Not yet built.** No `combo_main.cpp` or `actuator_main.cpp` code exists yet. Once built: (primary) the same ESP32 that posted the batch polls the cloud API and actuates onto the same plant; (stretch) a separate Actuator ESP32 does this for Plant B.
- **Defense Priming Proxy:** Dispenses a micro-dose of signaling proxy (saline or defense-priming compounds) directly into the target plant's root zone to trigger metabolic reallocation (root fortification and stomatal response). Hardware-level design, unaffected by the backend rewrite.
- **Resource Lifeline:** Option to deliver liquid N-P-K nutrients or hydration, mimicking the missing carbon, nitrogen, and water flux historically provided by mycorrhizal fungal networks.
- **Reliability Fallback:** A dedicated LED/buzzer array wired in parallel with the relay trigger to provide an immediate visual/audible "Target Network Node Primed" signal if the pump experiences mechanical binding or air lock.
- **Manual Replay Path:** Undesigned. The current API's `/ingest` only accepts real batch-shaped uploads — there's no manual "inject a test alert" endpoint yet. A dashboard-triggered synthetic `event:"spike"` batch (or a small dedicated test endpoint) is the likely shape, tracked alongside the pending-actuation gap in `plan.md`.

## Complete Bill of Materials (BOM)

| Component | Qty | Primary Function | Sourcing / Check |
|---|---|---|---|
| ESP32 Microcontrollers | 1 (primary) / 2 (stretch: separate sensor + actuator boards) | Combo board (primary), or Sensing Node (Node 1) & Actuating Node (Node 2) (stretch) | Micro Center / Amazon Overnight |
| ADS1115 16-Bit ADC | 1 | Precision differential voltage measurement | Micro Center / Adafruit |
| 18-Gauge Fine Silver Wire | 1 pair (primary: Plant A only) / 3 pairs (stretch: +Plant B, +Control) | Chlorided electrodes (Plant A, Plant B, Control) | Craft/Jewelry store or Amazon |
| 5V Relay Module | 1 | High-current switch for pump/actuator execution | Micro Center / Amazon |
| 5V Micro Peristaltic Pump | 1 | Precision fluid dispensing onto target plant | Amazon Overnight |
| LED + Buzzer Module | 1 | Primary fallback indicator for network actuation | Micro Center / Hardware bin |
| Potted Houseplants | 1 (primary) / 3 (stretch: +Plant B, +Control) | Plant A (Origin), Plant B (Target), Plant C (Control) | Local Grocery / Home Depot |
| Digital Multimeter | 1 | Line checking, impedance, and voltage sanity tests | Micro Center / Field Gear |
| Data-Capable USB Cables | 2 | ESP32 flashing and serial streaming (verified data pins) | Micro Center / Field Gear |

Cloud infrastructure is 2 Vultr instances (`saplink-api`, `saplink-web`) — not physical BOM parts, but tracked here since it replaced the originally planned single droplet.

## The Hackathon Demo Workflow

Steps below describe the primary single-plant/combo-board demo as intended; items marked NOT YET BUILT are open work, not already-working behavior.

1. **Baseline Verification:** Show Plant A's live baseline voltage stream via the dashboard (`app/frontend/index.html`, still to be built) polling `GET /samples` from `saplink-api`. Today, the same ingestion can be demonstrated directly with `curl`/`GET /samples`, since the dashboard HTML doesn't exist yet — the pipeline underneath is already live. (stretch: also show Plant B and the Control Plant.)
2. **Stress Application:** Apply a real localized stimulus (leaf pinch, cold shock, or saline dip) to Plant A, or arm `RecordedSignalPlayer`'s trigger to inject an artificial alert — Phase 2 work, not yet built.
3. **Signal Capture & Routing:** Working today for raw ingestion: `sensor_main.cpp` batches readings and POSTs them to `saplink-api`'s `/ingest`. Peak detection (Phase 2, sets `event:"spike"` on a qualifying batch) and its wiring into `combo_main.cpp` are not yet built.
4. **Actuation & Resource Provision:** **NOT YET IMPLEMENTED.** Blocked on both `combo_main.cpp` and the backend's still-undesigned pending-actuation mechanism (no ack/pending state exists today).
5. **Fallback Safety Net:** Planned: trigger a pre-recorded VP replay — locally on the sensor node, or via a manual API POST — to run the same routing/actuation sequence without live plant signal. Depends on Phase 2's `RecordedSignalPlayer` and the still-undesigned manual replay path.
