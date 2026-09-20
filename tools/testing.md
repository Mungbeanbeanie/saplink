# Pump false-trigger: diagnosis and calibration runbook

Why the pump ran unprompted, what the real thresholds are, and the exact steps to
calibrate rip-a-leaf vs fiddle-a-branch so the demo behaves predictably.

---

## Current rig state (as of last check, 03:09)

| channel | baseline | sigma | soil | verdict |
|---|---|---|---|---|
| `sense-1` | 46.7 mV, climbing ~3 mV/min | **10.5 mV** | 2031 mV (**~9%**) | dry, unusable |
| `sense-2` | −0.004 mV | **1.97 mV** | 1847 mV (~26%) | probe moved, degraded |

Both need fixing before any capture. Target: sigma under ~0.5 mV, flat baseline, on both.

Soil calibration from `src/soil_main.cpp:17-18` — dry (open air) 2154/2175 mV,
wet (immersed) 865/910 mV. **Higher mV = drier.**

---

## What causes the pump to fire

Not a cloud push. The board **polls its own alert back**:

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

Six seconds end to end. `sense-2`'s sigma had jumped 0.142 -> 3.02 mV in five
minutes because a hand was near the rig — **handling artifact fired the pump on
the plant nobody was touching.**

### Second, independent path

`pending_alert()` in `app/backend/main.py` selects the oldest un-acked alert with
**no age filter**, sqlite persists across restarts, and `last_actuate_ms` is 0 at
boot. A board reset therefore consumes a stale alert of any age and doses
immediately, cooldown skipped. Not yet fixed — see Phase 2.

---

## Measured numbers

Compiled `SignalConditioner` + `PeakDetector` natively and swept them:

| quantity | value |
|---|---|
| only absolute gate (`kMinAmplitudeMv`) | 2.0 mV |
| actual firing boundary | **2.05 mV** (fast deflection) |
| recorded VP reports | **39.52 mV** |
| bar sits below the target signal by | **19.8x** |
| simulated quiet sigma | 0.134 mV -> 3sigma bar 0.402 mV |
| **real electrode sigma** | **0.14 - 11 mV** (varies hugely by channel/condition) |
| white noise, 6 h, sigma 0.1/0.5/1.0 mV | 0 fires — noise is NOT the cause |
| post-watering transient >=5 mV | re-triggers at t+9.7s |

Trigger is `max(3*sigma, 2.0)`. Because sigma is measured, a noisy channel raises
its own bar — which is why `sense-1` at sigma 10.5 mV produced **no** alerts while
the quieter `sense-2` did. Peak-vs-threshold is meaningless on a noisy channel;
both come from the same garbage.

### How long the real VP holds each floor

| floor | VP holds it for |
|---|---|
| 2 mV | 5.2 s |
| 5 mV | 4.3 s |
| 8 mV | 3.8 s |
| 10 mV | 3.4 s |
| 15 mV | 2.9 s |
| 20 mV | 2.4 s |

---

## Why amplitude alone cannot separate the two demo events

- **Rip a leaf** -> wound response. Slow onset, sustained tens of seconds.
- **Fiddle a branch** -> handling artifact. Electrode motion plus body
  capacitance into a high-impedance pair. Starts and stops with your hand.

Confirmed on this rig: excursion #14 peaked at **26.23 mV** over 7.4 s (handling)
while #17 peaked at **12.79 mV** but held 327 samples (sustained). The handling
artifact was **twice the amplitude** of the sustained one.

**Duration is the discriminator.** Brief-and-huge vs long-and-moderate.

---

## Decisions already taken

- Calibrate from captured traces before setting any number.
- Live events are the demo. The `'r'`/`'t'` replay keeps injecting and plotting
  but **no longer needs to dose** (the 6 s waveform holds 8 mV for only 3.8 s, so
  any useful duration gate breaks it).
- Failure bias: **always fire on ripping**, accepting occasional spurious pumping.
- That bias removes the 30% rebound gate from the fire path — waiting for a wound
  response to recover would delay the dose by tens of seconds.

---

## Tools

| file | what it does |
|---|---|
| `tools/serial_log.py` | timestamped serial log. `pio device monitor` **cannot** be piped, so this replaces it |
| `tools/analyze_events.py` | segments a history trace into excursions, profiles each, derives X and T |

`analyze_events.py` bridges inter-batch gaps up to 15 s. The firmware samples
3.2 s per batch then spends ~3.6 s on soil reads, POSTs and the alert poll, so the
trace is **~45% duty cycle**. `PeakDetector` has no concept of those holes —
`held_` counts samples straight across them — so holds are reported in **samples**,
the unit `kMinDurationSamples` is in.

---

# STEP BY STEP — start here

```bash
# paste once per terminal session
API=https://api.saplink.us
SAP=~/Documents/Hackathons_and_projects/saplink
mkdir -p ~/saplink-capture
```

## Step 0 — fix the hardware (nothing else works until this passes)

1. **Unplug the pump.** Power or tube. It is currently live — the log shows
   `gpio26=1 (expect 1)`. Every spurious fire during calibration also waters
   plant 2 and contaminates that channel.
2. **Reseat plant 2's soil probe.** It went 787 -> 1847 mV in ten minutes; soil
   moisture does not change that fast, so it moved or lost contact.
3. **Get water to plant 1's root zone.** Its probe still reads ~2035 mV (~9%),
   statistically unchanged after the last watering — the water missed it. Confirm
   on serial that `soil` for `sense-1` actually **drops** before continuing.
4. **Walk away for 30 minutes.** Proximity alone trips the detector. Watch serial
   from across the room.

## Step 1 — start the serial log (Terminal A, leave running)

```bash
pkill -f serial_log.py                      # only one reader per port
cd $SAP
~/.platformio/penv/bin/python tools/serial_log.py /dev/cu.usbserial-0001 \
  | tee ~/saplink-capture/serial.log
```

## Step 2 — Terminal B setup

```bash
cd ~/saplink-capture
API=https://api.saplink.us
SAP=~/Documents/Hackathons_and_projects/saplink

# stamps each event with the seq the board last printed
mark() { echo "$(date +%H:%M:%S) $(tail -5 ~/saplink-capture/serial.log \
  | grep -ao 'seq=[0-9]*' | tail -1) $*" >> ~/saplink-capture/marks.txt; }
```

## Step 3 — check both channels have settled

```bash
grep -a "src=ads1115" ~/saplink-capture/serial.log | tail -6
```

**Gate: sigma under ~0.5 mV on both channels, baselines not trending.**
If `sense-1` sigma is still in double digits, go back to Step 0.3.

## Step 4 — quiet baseline

```bash
START_ID=$(curl -s $API/api/readings/latest \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["last_id"])')
echo "START_ID=$START_ID" | tee -a marks.txt
mark QUIET start
```

Leave it alone **5 minutes**, then:

```bash
mark QUIET end
curl -s "$API/api/readings/history?since_id=$START_ID&limit=2000" > quiet.json
python3 $SAP/tools/analyze_events.py quiet.json
```

**Gate: `0 excursion(s)`.** Anything else means the rig is not quiet — do not
proceed, fix the channel first.

## Step 5 — fiddles, 8 reps

Per rep: mark, handle 10-15 s, mark, wait 2 min.

```bash
mark fiddle 1 START
#  ... 10-15s: bend/jostle branches, brush wires, hand near the probe
mark fiddle 1 END
#  ... wait 2 min, repeat for 2..8
```

**Overdo it.** `T` is set just above the worst fiddle, so undersampling here makes
the demo fire spuriously. Do not tear or crush tissue — that is a rip.

## Step 6 — rips, 5 reps, on plant 1

Per rep: mark, tear one leaf, wait **5 minutes**.

```bash
mark rip 1
#  ... tear a leaf, under a second, then step back
#  ... wait 5 min, repeat for 2..5
```

- Different leaf every rep, never the one the electrode is on
- Hold only the leaf; steady the pot **before** you start, not during
- Tear rather than snip — a crush/tear is the stronger wound stimulus
- 5 minutes, not 2: repeated wounding weakens later responses, and `T` is set
  from your **worst** rep

## Step 7 — analyze

```bash
curl -s "$API/api/readings/history?since_id=$START_ID&limit=2000" > capture.json
python3 $SAP/tools/analyze_events.py capture.json
cat marks.txt
```

Match `seq` in `marks.txt` to the `seq` column, then label:

```bash
python3 $SAP/tools/analyze_events.py capture.json \
  --rip 9,10,11,12,13 --fiddle 1,2,3,4,5,6,7,8
```

Output gives `kMinAmplitudeMv` and `kMinDurationSamples`. **That is the
deliverable** — hand those two numbers over to start Phase 2.

---

## Reading the output

- `peak mV` — largest |deviation| in the excursion
- `span s` — wall-clock first to last sample, holes included
- `2..20` columns — longest run of **samples** above that mV floor
- `rebnd` — seconds until it recovered 30% off peak, or `never`
- `[replay]` tag — a waveform was injected; don't press `r`/`t` during capture

Invalidates a rep: a `[replay]` tag, or a fiddle showing a long hold (you leaned
on the plant — drop it and note why).

Useful checks:

```bash
grep -ac SPIKE ~/saplink-capture/serial.log        # detector fires
grep -a "pump ON" ~/saplink-capture/serial.log     # actual doses
grep -a "sense-1 src" ~/saplink-capture/serial.log | tail -5   # drift watch
```

---

## Phase 2 — after the numbers exist (not started)

- `peak_detector.h` — `kMinAmplitudeMv` + `kMinDurationSamples` from Step 7; add
  `kLatched` to the State enum
- `peak_detector.cpp` — replace deflect/rebound with sustained-amplitude;
  `threshold = adaptive > kMinAmplitudeMv ? adaptive : kMinAmplitudeMv`; latch
  after firing until the signal drops back under threshold (without it a 60 s rip
  re-fires every T and spams ~12 alerts)
- `app/backend/main.py` `pending_alert()` — add `AND created_ts > ?` bound to
  `time.time() - 60`, killing the stale-alert-on-boot dose
- tests — add `test_short_transient_does_not_fire`,
  `test_sustained_deflection_fires`, `test_one_event_fires_once`; rewrite
  `test_recorded_waveform_fires` (replay no longer doses)

Full plan: `~/.claude/plans/stateless-churning-bee.md`

## Known issues, not scheduled

- **Hardware, no code fix:** pump inrush can brown out the ESP32 -> reset ->
  GPIO26 floats at ~1482 mV (measured, `src/relayoff_main.cpp:9`) -> relay may
  click on boot. Needs a ~10k pulldown on relay IN. Rule this in or out on the
  bench before blaming firmware.
- A stray serial byte `'p'` runs `actuate("manual test")` unconditionally
  (`src/combo_main.cpp:438`).
- `kMinAmplitudeMv` is class-level, shared by both plants, while their sigmas
  differ by up to 70x. Existing note at `peak_detector.h:42-49`.
- `pending_alert()` has no target filter — plant 1's event runs plant 2's pump.
  Deliberate; that is the demo.
- If rip and fiddle overlap in Step 7, **no threshold fixes it.** The lever is
  electrode placement (nearer the wound site, better soil reference), not code.
