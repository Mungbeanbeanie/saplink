# Pump false-trigger: compressed calibration runbook

**Deadline mode.** Full plan is in `~/.claude/plans/stateless-churning-bee.md`; this
is the ~50 minute path to a demo that behaves.

---

## Rig state — GREEN, proceed

| | soil | moisture | noise (sd of deviation) | baseline |
|---|---|---|---|---|
| `sense-1` | 1546 mV | 47% | **0.48 mV** | 67.2 mV, flat |
| `sense-2` | 1389 mV | 62% | **0.17 mV** | 1.1 mV, flat |

Both usable. `sense-2` is the cleaner channel.

### Read `soil`, NOT `baseline`

This cost an hour. They are different measurements:

- **`soil=NNNNmv`** — the moisture probe. **Higher = drier.** Dry (open air)
  2154/2175 mV, wet (immersed) 865/910 mV (`src/soil_main.cpp:17-18`). This is
  what drops when you water.
- **`baseline=NNNNmv`** — the electrode's standing stem-vs-soil potential. Not a
  moisture reading. A stable 67 mV offset is fine; the conditioner subtracts it.

Watering worked: `sense-1` went 2031 mV (9%) -> 1546 mV (47%), and its noise fell
from sigma 10.5 mV to 0.48 mV.

---

# DO THIS

## 0. Setup + reconfigure (5 min)

```bash
API=https://api.saplink.us
SAP=~/Documents/Hackathons_and_projects/saplink
mkdir -p ~/saplink-capture && cd ~/saplink-capture
```

1. **Unplug the pump** for the capture. Plug back in before the demo.
2. **Move the pump tube to plant 1's pot.** `pending_alert()` has no target
   filter, so *any* plant's alert fires the pump — the sender does not have to be
   plant 1. Ripping `sense-2` (cleaner channel) while the pump waters plant 1
   gives the full plant-A-signals-plant-B story on the better electrode, and the
   watered plant becomes the one whose channel matters less. No code change.

Serial log, optional but useful (Terminal A, leave running):

```bash
pkill -f serial_log.py          # only one reader per port
cd $SAP && ~/.platformio/penv/bin/python tools/serial_log.py /dev/cu.usbserial-0001 \
  | tee -a ~/saplink-capture/serial.log
```

## 1. Capture — 3 fiddles, 3 rips (15 min)

```bash
START_ID=$(curl -s $API/api/readings/latest \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["last_id"])')
echo "START_ID=$START_ID" | tee -a ~/saplink-capture/marks.txt

mark() { echo "$(date +%H:%M:%S) $(tail -5 ~/saplink-capture/serial.log \
  | grep -ao 'seq=[0-9]*' | tail -1) $*" >> ~/saplink-capture/marks.txt; }
```

**3x fiddle**, 2 min apart. 10-15 s of handling each — bend branches, brush the
wires, hand near the probe. Overdo it: `T` is set just above the worst fiddle.
Do not tear tissue.

```bash
mark fiddle 1     # ... handle 10-15s ... wait 2 min ... repeat 2,3
```

**3x rip** on plant 2, 2 min apart. Tear one leaf (not the electrode's leaf),
under a second, **then step back**.

```bash
mark rip 1        # ... tear ... wait 2 min ... repeat 2,3
```

> Step back after every event. The `id=47` spurious fire happened because a hand
> was near the rig. Proximity alone trips it.

## 2. Analyze (5 min)

```bash
curl -s "$API/api/readings/history?since_id=$START_ID&limit=2000" > capture.json
python3 $SAP/tools/analyze_events.py capture.json --device sense-2
cat ~/saplink-capture/marks.txt
```

Match `seq` in `marks.txt` to the `seq` column, then label:

```bash
python3 $SAP/tools/analyze_events.py capture.json --device sense-2 \
  --rip 4,5,6 --fiddle 1,2,3
```

**Take `kMinAmplitudeMv` from the output.**

If rip and fiddle overlap and nothing separates: set `kMinAmplitudeMv` to
**half your smallest rip peak** and move on. That keeps the rip firing (the
stated bias) while clearing the 2.87 mV noise floor by a wide margin.

## 3. Change ONE constant (10 min)

**Do not do the full detector rewrite today.** Restructuring the state machine
two hours before a demo is how you get a rip that fires nothing. Change the
amplitude floor only and keep the rebound gate:

`lib/saplink_common/peak_detector.h:55`

```cpp
static constexpr float kMinAmplitudeMv = 2.0f;   // -> your number
```

Then:

```bash
cd $SAP/esp32/Saplink
~/.platformio/penv/bin/pio test -e native          # must stay green
~/.platformio/penv/bin/pio run -e combo -t upload
```

If `pio test` fails because a test asserts the old 2.0 mV behaviour, that is the
expected casualty — check it is `test_sub_millivolt_vp_shape_does_not_fire` or a
recorded-waveform test, not something else, then move on.

## 4. Verify (15 min)

```bash
pkill -f serial_log.py
cd $SAP && ~/.platformio/penv/bin/python tools/serial_log.py /dev/cu.usbserial-0001 \
  | tee -a ~/saplink-capture/serial.log
```

Plug the pump back in. Then:

1. **Fiddle a branch.** Expect **no** `SPIKE`, no `pump ON`.
2. Wait 1 min. **Rip a leaf, step back.** Expect `SPIKE` -> `postAlert` ->
   `ackAlert` -> `pump ON  (alert)` within ~6 s.
3. **Leave it alone 5 min.** Expect zero `pump ON`.

```bash
grep -ac SPIKE ~/saplink-capture/serial.log
grep -a "pump ON" ~/saplink-capture/serial.log
```

If the rip does not fire: lower `kMinAmplitudeMv`, reflash, retest. Bias is
always-fire-on-ripping — a spurious dose is survivable, a dead demo is not.

**Then stop touching it.**

---

## What fires the pump (for the writeup)

Not a cloud push — the board **polls its own alert back**:

```
detector fires -> cloud.postAlert -> POST /api/alerts
  -> board's own GET /api/alerts/pending -> ackAlert -> actuate()
```

`src/combo_main.cpp:598`. Captured live:

```
03:05:45 seq=1124 sense-2 ... sigma=3.023mv ... SPIKE
03:05:49 postAlert 200
03:05:51 ackAlert 200 id=47
03:05:51 pump ON  (alert) t=8280287
03:05:51   gpio26=1 (expect 1)
03:05:53 pump OFF t=8281788
```

`sense-2`'s sigma had jumped 0.142 -> 3.02 mV in five minutes because a hand was
near the rig. **A handling artifact fired the pump on the plant nobody was
touching.**

## Measured numbers

| quantity | value |
|---|---|
| only absolute gate (`kMinAmplitudeMv`) | 2.0 mV |
| actual firing boundary | **2.05 mV** |
| recorded VP reports | **39.52 mV** |
| bar sits below the target signal by | **19.8x** |
| real electrode sigma | 0.17 - 11 mV depending on condition |
| white noise, 6 h, sigma 0.1/0.5/1.0 mV | 0 fires — noise is NOT the cause |

Trigger is `max(3*sigma, 2.0)`. Because sigma is measured, a noisy channel raises
its own bar — which is why `sense-1` at sigma 10.5 mV produced **no** alerts while
the quieter `sense-2` did.

## Why amplitude alone cannot separate the two events

- **Rip a leaf** -> wound response. Slow onset, sustained tens of seconds.
- **Fiddle a branch** -> handling artifact. Electrode motion plus body
  capacitance into a high-impedance pair. Stops with your hand.

Confirmed on this rig: excursion #14 peaked at **26.23 mV** over 7.4 s (handling)
while #17 peaked at **12.79 mV** but held 327 samples. The handling artifact was
**twice the amplitude** of the sustained one. Duration is the real discriminator —
which is why the full fix is a duration gate, not a bigger number.

## Tools

| file | what it does |
|---|---|
| `tools/serial_log.py` | timestamped serial log. `pio device monitor` **cannot** be piped, so this replaces it |
| `tools/analyze_events.py` | segments a trace into excursions, profiles each, derives X and T |

`analyze_events.py` bridges gaps up to 15 s. The firmware samples 3.2 s per batch
then spends ~3.6 s on soil reads, POSTs and the alert poll — **~45% duty cycle**.
`PeakDetector` has no concept of those holes (`held_` counts straight across
them), so holds are reported in **samples**, the unit `kMinDurationSamples` is in.

Reading the listing: `peak mV` = largest |deviation|; `span s` = wall clock incl.
holes; `2..20` = longest run of samples above that floor; `rebnd` = seconds to
recover 30% off peak; `[replay]` = injected waveform, don't press `r`/`t`.

---

## Deferred — after the demo

- **Full Phase 2**: replace deflect/rebound with sustained-amplitude
  (`kMinAmplitudeMv` + `kMinDurationSamples`), add `kLatched` so one event fires
  one alert, drop the rebound gate from the fire path.
- **Stale-alert dose**: `pending_alert()` selects the oldest un-acked alert with
  **no age filter**, sqlite persists, `last_actuate_ms` is 0 at boot — so a reset
  doses immediately on an alert of any age. Fix: `AND created_ts > ?` bound to
  `time.time() - 60`.
- **Brownout**: pump inrush can reset the ESP32 -> GPIO26 floats ~1482 mV
  (`src/relayoff_main.cpp:9`) -> relay may click on boot. Needs a ~10k pulldown on
  relay IN. No code fix.
- Stray serial `'p'` runs `actuate("manual test")` unconditionally
  (`src/combo_main.cpp:438`).
- `kMinAmplitudeMv` is class-level, shared by both plants, while their sigmas
  differ by up to 70x (`peak_detector.h:42-49`).

## If it goes wrong mid-demo

- **Pump running away** — unplug it, or flash the e-stop:
  `pio run -e relayoff -t upload`
- **Board in `DOWNLOAD_BOOT` / `waiting for download`** — it is not running
  firmware. Press EN/RST **alone**, do not hold BOOT.
- **Nothing ingesting** — check `curl -s $API/api/readings/latest` returns a
  recent `seq`.
