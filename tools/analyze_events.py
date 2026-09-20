#!/usr/bin/env python3
"""Read a /api/readings/history trace and measure what separates a leaf-rip from
branch-fiddling, so PeakDetector's amplitude floor (X) and duration gate (T) are
set from data instead of guessed.

Why this exists: the detector's only absolute gate is kMinAmplitudeMv = 2.0mV,
and the measured firing boundary is 2.05mV against a recorded VP of 39.52mV --
a bar ~20x below the signal it exists to detect. Anything real doses the plant.
Amplitude alone cannot separate the two demo events either: handling couples a
body into a high-impedance differential pair and can swing more than a genuine
wound response does. Duration can -- sustained-and-ongoing vs transient-and-gone
-- and this prints the numbers that prove or kill that.

Reads `mv`, NOT `raw_mv`: combo_main.cpp writes cond.deviation() into mv[], so
mv IS the value PeakDetector::check() was handed, sample for sample. Re-running
the conditioner here would only add a way for the two to disagree.

Usage:
    curl -s 'https://<host>/api/readings/history?since_id=0&limit=2000' > t.json
    python3 tools/analyze_events.py t.json
    python3 tools/analyze_events.py t.json --rip 1,3,5 --fiddle 2,4,6
    python3 tools/analyze_events.py --url https://<host> --limit 2000
    python3 tools/analyze_events.py --selftest
"""

import argparse
import json
import sys
import urllib.request
from collections import Counter

# Candidate amplitude floors to profile each event against, in mV. The gap
# between the classes at one of these is what X gets set to.
FLOORS = (2.0, 4.0, 6.0, 8.0, 10.0, 15.0, 20.0)

# Low enough to catch everything the CURRENT firmware would fire on (boundary
# measured at 2.05mV), so an event can never be missed by the segmenter and
# then silently absent from the comparison.
DETECT_FLOOR = 1.5

# What counts as "recovered" for the rebound column -- the 30% the detector's
# old rebound gate looked for, expressed as a fraction of peak remaining.
REBOUND_REMAINING = 0.70

# Inter-batch holes are BRIDGED, not treated as breaks. Measured on the rig: a
# batch covers 3.2s of samples (32 x 100ms) but batches land ~6.8s apart -- the
# other ~3.6s goes on soil reads, two POSTs and the alert poll, and no samples
# exist for it. ~47% duty cycle.
#
# PeakDetector has no concept of that hole: held_ counts consecutive samples
# handed to check(), straight across the boundary, because combo_main.cpp never
# resets the detector between batches. So counting the detector's way means
# ignoring wall-clock gaps -- otherwise every hold caps at 32 samples and a
# deflection lasting longer than one batch can never be measured at all, which
# is the whole point of the exercise.
#
# 15s, not unlimited: a board that was offline or rebooted must still break the
# run. Raise it only if batch cadence ever gets slower than this.
BRIDGE_MS = 15000


def load(path=None, url=None, limit=2000):
    if url:
        # No auth: GET /api/readings/history takes no Authorization header
        # (main.py:252) -- unlike /api/readings and the alert routes.
        u = f"{url.rstrip('/')}/api/readings/history?since_id=0&limit={limit}"
        with urllib.request.urlopen(u, timeout=30) as r:
            doc = json.load(r)
    elif path == "-":
        doc = json.load(sys.stdin)
    else:
        with open(path) as f:
            doc = json.load(f)
    return doc["samples"] if isinstance(doc, dict) else doc


def infer_period_ms(series):
    """Sample period, taken from the data rather than assumed to be 100ms.

    /api/readings/history flattens period_ms away -- it returns t_ms already
    multiplied out per sample (main.py:242) -- so the modal positive delta is
    the only thing left to read it off. Modal, not mean: the trace has gaps
    between uploaded batches and a mean would sit between the two.
    """
    deltas = Counter()
    for a, b in zip(series, series[1:]):
        d = b["t_ms"] - a["t_ms"]
        if 0 < d <= 1000:
            deltas[d] += 1
    return deltas.most_common(1)[0][0] if deltas else 100


def _continuous(prev_t, t, period_ms):
    # Bridges the inter-batch hole -- see BRIDGE_MS. period_ms is unused now
    # but kept in the signature: it is what a future per-trace cadence check
    # would key off, and every caller already has it to hand.
    return prev_t is None or (t - prev_t) <= BRIDGE_MS


def excursions(series, period_ms, floor=DETECT_FLOOR):
    """Split a device's samples into runs that stay above `floor`."""
    out, cur, prev_t = [], [], None
    for s in series:
        if cur and not _continuous(prev_t, s["t_ms"], period_ms):
            out.append(cur)
            cur = []
        if abs(s["mv"]) >= floor:
            cur.append(s)
        elif cur:
            out.append(cur)
            cur = []
        prev_t = s["t_ms"]
    if cur:
        out.append(cur)
    return out


def hold_above(samples, floor, period_ms):
    """Longest run above `floor`, in SAMPLES.

    Samples, not seconds, because that is the unit kMinDurationSamples is in --
    the detector counts samples and never looks at a clock, so a number here
    drops straight into the header with no conversion to get wrong.

    Longest run, not total count: the detector needs consecutive samples, so a
    signal that crosses the floor ten times for one sample each is not the same
    as one that holds it for ten, and summing would call them equal.
    """
    best = run = 0
    prev_t = None
    for s in samples:
        if abs(s["mv"]) >= floor:
            run = run + 1 if _continuous(prev_t, s["t_ms"], period_ms) else 1
        else:
            run = 0
        best = max(best, run)
        prev_t = s["t_ms"]
    return best


def profile(samples, period_ms):
    """Everything measurable about one excursion."""
    peak_i = max(range(len(samples)), key=lambda i: abs(samples[i]["mv"]))
    peak = abs(samples[peak_i]["mv"])
    onset = samples[0]["t_ms"]

    rebound_s = None
    for s in samples[peak_i:]:
        if abs(s["mv"]) <= peak * REBOUND_REMAINING:
            rebound_s = (s["t_ms"] - onset) / 1000.0
            break

    return {
        "device": samples[0]["device"],
        # The board prints seq per batch on serial, so this is the one field
        # that ties a row here to something you watched happen on the bench.
        # t_ms is board millis, not wall clock, and history flattens recv_ts
        # away -- without seq there is nothing to align a stopwatch against.
        # .get: batches predating the column, and hand-rolled curl posts, ingest
        # without one (main.py keeps them for exactly that reason).
        "seq": samples[0].get("seq") if samples[0].get("seq") is not None else -1,
        "onset_ms": onset,
        "peak_mv": peak,
        "total_s": (samples[-1]["t_ms"] - onset) / 1000.0 + period_ms / 1000.0,
        "rebound_s": rebound_s,
        "replay": any(s["replay"] for s in samples),
        "holds": {f: hold_above(samples, f, period_ms) for f in FLOORS},
    }


def print_coverage(samples, period_ms):
    """Duty cycle, printed because a low one silently caps every hold.

    The board samples for one batch then stops while it does soil reads, two
    POSTs and the alert poll. If that dead time is large the trace is mostly
    holes, and any duration read off it is a statement about the firmware's
    loop, not about the plant.
    """
    span_ms = samples[-1]["t_ms"] - samples[0]["t_ms"] + period_ms
    covered = len(samples) * period_ms
    duty = 100.0 * covered / span_ms if span_ms else 0
    print(f"{len(samples)} samples over {span_ms/1000:.0f}s -> {duty:.0f}% duty cycle")
    if duty < 80:
        print(f"  gaps bridged up to {BRIDGE_MS/1000:.0f}s (detector counts "
              f"samples, not clock time -- see BRIDGE_MS)")


def print_listing(profs, period_ms):
    print(f"\nsample period {period_ms}ms  ({1000/period_ms:.1f} Hz)")
    print(f"{len(profs)} excursion(s) above {DETECT_FLOOR}mV\n")
    head = f"{'#':>3} {'device':<10} {'seq':>7} {'t+s':>8} {'peak':>7} {'span':>7} {'rebnd':>7}  "
    head += " ".join(f"{f:>5.0f}" for f in FLOORS)
    print(head)
    print(f"{'':>3} {'':<10} {'':>7} {'':>8} {'mV':>7} {'s':>7} {'s':>7}  "
          + " ".join(f"{'smp':>5}" for _ in FLOORS))
    print("-" * len(head))
    t0 = min(p["onset_ms"] for p in profs) if profs else 0
    for i, p in enumerate(profs, 1):
        reb = f"{p['rebound_s']:.1f}" if p["rebound_s"] is not None else "never"
        tag = " [replay]" if p["replay"] else ""
        print(f"{i:>3} {p['device'][:10]:<10} {p['seq']:>7} {(p['onset_ms']-t0)/1000:>8.1f} "
              f"{p['peak_mv']:>7.2f} {p['total_s']:>7.1f} {reb:>7}  "
              + " ".join(f"{p['holds'][f]:>5d}" for f in FLOORS) + tag)
    print("\ncolumns 2..20 = longest run of SAMPLES held above that mV floor")
    print("(samples, not seconds: that is the unit kMinDurationSamples is in)")
    print("span = wall-clock first to last sample, holes included")


def compare(profs, rip_ix, fiddle_ix, period_ms):
    rips = [profs[i - 1] for i in rip_ix]
    fids = [profs[i - 1] for i in fiddle_ix]
    print(f"\n{'='*60}\nrip (n={len(rips)})  vs  fiddle (n={len(fids)})\n{'='*60}")
    print(f"{'floor mV':>9} {'rip min hold':>14} {'fiddle max hold':>17} {'separates?':>14}")
    print("-" * 58)

    best = None
    for f in FLOORS:
        rip_min = min(p["holds"][f] for p in rips)
        fid_max = max(p["holds"][f] for p in fids)
        ok = rip_min > fid_max and rip_min > 0
        margin = rip_min - fid_max
        print(f"{f:>9.0f} {rip_min:>11d} smp {fid_max:>14d} smp "
              f"{('YES +%d smp' % margin) if ok else 'no':>14}")
        # HIGHEST separating floor, not the widest margin. Low floors always
        # win on margin, but the floor is what rejects everything that is
        # neither event -- drift, the >=5mV post-watering transient, a hand
        # near the rig. Leaving it at 2.0 makes the duration gate do all the
        # work and keeps the pump exposed to every 2mV wobble that outlasts T,
        # which is the bug this whole exercise started from. Duration separates
        # rip from fiddle; amplitude separates both from the room.
        if ok:
            best = (f, rip_min, fid_max, margin)

    print(f"\npeak mV   rip {min(p['peak_mv'] for p in rips):.1f}"
          f"-{max(p['peak_mv'] for p in rips):.1f}    "
          f"fiddle {min(p['peak_mv'] for p in fids):.1f}"
          f"-{max(p['peak_mv'] for p in fids):.1f}")

    if best is None:
        print("\nNO FLOOR SEPARATES THESE EVENTS.")
        print("No threshold fixes this -- the two stimuli overlap at the electrode.")
        print("Next lever is placement (probe nearer the wound site, better soil")
        print("reference), not code. Re-capture before changing the detector.")
        return

    floor, rip_min, fid_max, margin = best
    # T must sit in (fiddle_max, rip_min]. Biased LOW per the
    # always-fire-on-ripping decision -- 25% in, so three quarters of the
    # window protects the event that MUST fire. Not one sample above fid_max:
    # that honours the bias literally but puts T on a cliff where one
    # fiddle 100ms longer than any measured doses the plant. A quarter of the
    # window keeps the bias and still leaves the fiddle side a real margin.
    t_samples = round(fid_max + 0.25 * (rip_min - fid_max))
    # STRICTLY above the worst fiddle. The gate is `held_ >= kMinDurationSamples`,
    # so a T that rounds down onto fid_max fires on the very event it must
    # reject -- which is what a narrow window does to the line above.
    t_samples = max(t_samples, fid_max + 1)
    print(f"\n  kMinAmplitudeMv     = {floor:.1f}f")
    print(f"  kMinDurationSamples = {t_samples}   "
          f"// {t_samples * period_ms / 1000:.1f}s of samples at {1000/period_ms:.0f}Hz")
    print(f"\n  window {fid_max} < T <= {rip_min} samples, biased low")
    print(f"  rip margin {rip_min - t_samples} smp | "
          f"fiddle margin {t_samples - fid_max} smp")
    if margin < 10:
        print(f"\n  WARNING: only {margin} samples of separation. Add reps "
              f"before trusting this.")


def selftest():
    # ponytail: synthetic, not a fixture file. Checks the parts that can be
    # silently wrong -- gap handling, longest-run vs total, and that a brief
    # LARGE event loses to a long smaller one, which is the whole premise.
    period = 100

    def mk(t0, n, mv, dev="p"):
        return [{"t_ms": t0 + i * period, "mv": mv, "device": dev,
                 "replay": False, "seq": (t0 + i * period) // 3200}
                for i in range(n)]

    # fiddle: 20mV for 1.0s. rip: 10mV for 8.0s. 30s of quiet between.
    series = (mk(0, 50, 0.1) + mk(5000, 10, -20.0) + mk(6000, 100, 0.1)
              + mk(16000, 80, -10.0) + mk(24000, 50, 0.1))
    assert infer_period_ms(series) == period

    ex = excursions(series, period)
    assert len(ex) == 2, ex
    profs = [profile(e, period) for e in ex]
    assert abs(profs[0]["peak_mv"] - 20.0) < 0.01
    assert abs(profs[1]["peak_mv"] - 10.0) < 0.01
    assert profs[0]["holds"][8.0] == 10, profs[0]["holds"]   # 10 samples
    assert profs[1]["holds"][8.0] == 80, profs[1]["holds"]   # 80 samples
    # Amplitude ranks them backwards; duration ranks them right. The premise.
    assert profs[0]["peak_mv"] > profs[1]["peak_mv"]
    assert profs[1]["holds"][8.0] > profs[0]["holds"][8.0]

    # The real rig's shape: 32-sample batches ~6.8s apart, so a deflection
    # spanning 3 batches has 3.6s holes in it. The detector never sees those
    # holes, so this must count 96 -- NOT cap at 32, which is what breaking on
    # the gap did and what made a rip longer than one batch unmeasurable.
    batched = []
    for b in range(3):
        batched += mk(b * 6800, 32, -10.0)
    assert hold_above(batched, 8.0, period) == 96, hold_above(batched, 8.0, period)
    assert len(excursions(batched, period)) == 1

    # But a real outage still breaks it: 30s hole is past BRIDGE_MS.
    gapped = mk(0, 20, -10.0) + mk(30000, 20, -10.0)
    assert hold_above(gapped, 8.0, period) == 20

    # Above the floor but crossing it repeatedly -> longest run, not the total.
    choppy = []
    for i in range(10):
        choppy += mk(i * 1000, 5, -10.0) + mk(i * 1000 + 500, 5, 0.0)
    assert hold_above(choppy, 8.0, period) <= 6, hold_above(choppy, 8.0, period)

    print("selftest ok")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("trace", nargs="?", help="history JSON file, or - for stdin")
    ap.add_argument("--url", help="fetch from a running API instead")
    ap.add_argument("--limit", type=int, default=2000, help="batches to fetch")
    ap.add_argument("--device", help="only this device stream")
    ap.add_argument("--rip", default="", help="excursion numbers, e.g. 1,3,5")
    ap.add_argument("--fiddle", default="", help="excursion numbers, e.g. 2,4,6")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()

    if a.selftest:
        return selftest()
    if not a.trace and not a.url:
        ap.error("need a trace file or --url")

    samples = load(a.trace, a.url, a.limit)
    if a.device:
        samples = [s for s in samples if s["device"] == a.device]
    if not samples:
        sys.exit("no samples")
    samples.sort(key=lambda s: (s["device"], s["t_ms"]))

    period_ms = infer_period_ms(samples)
    print_coverage(samples, period_ms)
    profs = []
    for dev in sorted({s["device"] for s in samples}):
        series = [s for s in samples if s["device"] == dev]
        profs += [profile(e, period_ms) for e in excursions(series, period_ms)]
    profs.sort(key=lambda p: p["onset_ms"])

    print_listing(profs, period_ms)

    rip = [int(x) for x in a.rip.split(",") if x.strip()]
    fid = [int(x) for x in a.fiddle.split(",") if x.strip()]
    if rip and fid:
        bad = [i for i in rip + fid if not 1 <= i <= len(profs)]
        if bad:
            sys.exit(f"no such excursion(s): {bad}")
        compare(profs, rip, fid, period_ms)
    else:
        print("\nlabel them to get X and T:  --rip 1,3,5 --fiddle 2,4,6")


if __name__ == "__main__":
    main()
