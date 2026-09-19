## Status: Staged — awaiting `apply`

## Task: soil calibration + replay trigger + doc realignment

### 1. Soil moisture calibration — `app/backend/main.py`
- Derive pct in backend, NOT firmware. Firmware keeps sending raw `soil_mv` unchanged.
- Rationale: recalibrate without reflashing; raw mV stays in DB so a bad calibration is re-derivable.
- Add env vars `SOIL_DRY_MV`, `SOIL_WET_MV`. No defaults — unset means `soil_pct: None`.
- Capacitive probe is inverted: dry reads HIGH, wet reads LOW.
- `_flatten()`: `pct = (dry - mv) / (dry - wet) * 100`, clamp 0..100.
- Guards → `None`: either env var unset, `dry == wet` (div-zero), `soil_mv is None`.
- `soil_pct` computed on read, not stored. No new column, no migration.
- `test_ingest.py`: `test_soil_pct_from_calibration`, `test_soil_pct_null_without_calibration`.
- BLOCKED: needs two measured readings from user (probe in air, probe in water).

### 2. RecordedSignalPlayer trigger — `esp32/Saplink/src/combo_main.cpp`
- Add `#include "recorded_signal.h"`, `static RecordedSignalPlayer player;`.
- Trigger: `Serial.read() == 'r'` checked once at top of `loop()`, not per sample.
- Sample loop: `float mv = readMv(n); float rp; if (player.nextSample(rp)) mv += rp;`
- SUPERIMPOSE, not replace. Waveform is 0-centred; replacing would step baseline ~100mV and read as artifact. Riding the live baseline matches a real VP and matches `test_deflection_on_top_of_offset_fires`.
- Waveform = 60 samples @10Hz = 6s; `BATCH_N`=32 → replay spans ~2 batches.
- Track `bool replayed` per batch, true if any sample injected.
- Contract (additive, same pattern as `soil_mv`): `replay: bool = False` in `Batch`, `ALTER TABLE batch ADD COLUMN replay INTEGER`, add to `COLS`/insert/`_flatten`.
- Reason for the flag: `src` stays `"ads1115"` because the ADC really is live; without a separate flag an injected spike is indistinguishable from a real one on the dashboard.
- No `platformio.ini` change — `recorded_signal.cpp` already compiles as part of `lib/saplink_common/`.

### 3. `.claude/architecture.md` realignment — stale facts only
- `sensor_main.cpp` listed as built → does not exist; `env:sensor` fails to build.
- `actuator_main.cpp` → does not exist; `env:actuator` fails to build.
- `lib/saplink_common/` marked "does not exist yet" → exists.
- "No `cloud_client.h`/`packet_schema.h` — both dropped" → both exist and compile.
- Missing from tree: `blink_main.cpp`, `soil_main.cpp`, `probe_main.cpp`; envs `blink`/`soil`/`probe`.
- Missing: `env:combo`/`env:probe` `lib_deps = adafruit/Adafruit ADS1X15`.
- Missing: `env:combo` needs `build_flags = -I include` — LDF compiles `cloud_client.cpp`, which includes `secrets.h`; PlatformIO gives that path to `src/` but not to a library built as its own static lib.
- `combo_main.cpp` dep line → add `signal_conditioning.h`, `peak_detector.h` (+ `recorded_signal.h` after item 2); drop "planned".
- Backend `Batch` → note `soil_mv` (+ `replay` after item 2).

### Open decisions — answer before `apply`
- ~~Replay flag~~ DECIDED: additive `replay` field, per item 2 as written.
- Soil `dry`/`wet` mV values: still needed. Must come from the GPIO34 capacitive sensor, NOT the A3 reference electrode — moving A3 to water swung A2-A3 by ~540mV and left `soil_mv` unchanged at ~2050, confirming they are separate devices.
- ~~Canonical contract doc~~ DONE. `esp32/Saplink/CLAUDE.md` never existed post-`29a6dc5` (deleted 93min after the `.claude/` merge; citations were valid when written, orphaned by the delete). `overview.md`'s "Interface Schema" is now declared canonical; `architecture.md`:38/:61 and `overview.md`:9/:82 re-pointed. Operational content (Caddy/LE gotchas) had already survived into `plan.md` — nothing lost.
- REMAINING, not done: 8 stale route refs in `overview.md` (:18 :31 :51 :59 :75 :89 :111 :113) — `/ingest`→`/api/readings`, `/samples`+`/events`→`/api/readings/history`+`/latest`, `sensor_main.cpp`→`combo_main.cpp`. Four are inside ASCII diagrams. Mechanical pass, awaiting go-ahead.

### Not in scope
- Actuate half of `combo_main.cpp` — still blocked on Phase 5 alert control plane.
- σ currently ~5.8mV (absorbs electrode drift-lag, not just noise). Self-tightens as electrode settles; revisit only if it does not.
