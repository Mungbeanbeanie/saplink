#!/usr/bin/env python3
"""Last-resort ingestion path: relay the board's batches over USB to the API.

For the case where no network in the room will take the ESP32 -- 5GHz-only
hotspot, WPA2-Enterprise campus wifi, or a captive portal the board cannot click
through. The LAPTOP can get online in all three of those cases, and it is
already holding the other end of the flashing cable, so it relays.

    pio run -e serialingest -t upload          # firmware half of the switch
    ~/.platformio/penv/bin/python tools/serial_bridge.py

Nothing else about the demo changes: same JSON, same endpoints, same dashboard.
Actuation still round-trips through the cloud -- this polls /api/alerts/pending
and acks exactly as the board would, then sends 'p' down the cable to fire the
pump. The cloud still decides; only the return wire is different.

pyserial is not in system python3 but ships inside PlatformIO's venv, so run
this with that interpreter -- same trick as serial_log.py, no new dependency.
"""

import collections
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

# pyserial is imported inside main(), not here: it only exists in PlatformIO's
# venv, and a --selftest that demands the right interpreter is one nobody runs.

PORT = sys.argv[1] if len(sys.argv) > 1 else "/dev/cu.usbserial-0001"
BAUD = 115200
BATCH_MARKER = "@R "
ALERT_MARKER = "@A "

SECRETS = pathlib.Path(__file__).resolve().parent.parent / "esp32/Saplink/include/secrets.h"

# Poll the alert plane on the same cadence the board would, not per line: a
# batch arrives every ~2s per plant and an extra GET per batch buys nothing.
POLL_INTERVAL_S = 3.0
# Matches combo_main.cpp's kMinActuateGapMs. Duplicated deliberately -- the
# firmware's copy is unreachable in this mode, so without it here the reservoir
# has no protection at all.
MIN_ACTUATE_GAP_S = 30.0


def parse_frame(line):
    """-> (path, payload) for a marked frame, or None for anything else.

    None is the COMMON case, not an error: this UART also carries the board's
    own log lines and, while the pump runs, framing garbage. payload is None on
    a marked-but-corrupt frame, which is one lost batch rather than a crash.
    """
    for marker, path in ((BATCH_MARKER, "/api/readings"), (ALERT_MARKER, "/api/alerts")):
        if line.startswith(marker):
            try:
                return path, json.loads(line[len(marker):])
            except json.JSONDecodeError:
                return path, None
    return None


class Seen:
    """Bounded (device, seq) dedupe. Bounded because this runs for hours on a
    demo table, and NOT a monotonic high-water mark because a spike posts the
    held-back previous batch at seq-1 AFTER seq -- "seq must increase" would
    drop exactly the pre-trigger context that batch exists to carry."""

    def __init__(self, maxlen=500):
        self._q = collections.deque(maxlen=maxlen)
        self._set = set()

    def is_new(self, key):
        if key in self._set:
            return False
        if len(self._q) == self._q.maxlen:
            self._set.discard(self._q[0])
        self._q.append(key)
        self._set.add(key)
        return True


def selftest():
    ok, bad = parse_frame('@R {"device":"sense-1","seq":4}'), parse_frame("@R {oops")
    assert ok == ("/api/readings", {"device": "sense-1", "seq": 4}), ok
    assert bad == ("/api/readings", None), bad
    assert parse_frame('@A {"node_id":2}') == ("/api/alerts", {"node_id": 2})
    # Board log lines and EMI must not be mistaken for data.
    assert parse_frame("POST 200 sense-2 seq=7") is None
    assert parse_frame('\xd0\xd0{"device":"x","seq":1}') is None

    s = Seen(maxlen=2)
    assert s.is_new(("sense-1", 1)) and not s.is_new(("sense-1", 1))
    # The observed failure: this adapter replays its buffer, so the same batch
    # arrives many times and would be charted many times.
    assert s.is_new(("sense-2", 1)), "same seq, different device is NOT a dupe"
    assert s.is_new(("sense-1", 3))  # evicts ("sense-1", 1)
    assert s.is_new(("sense-1", 1)), "eviction must forget, not error"
    # Out-of-order pre-trigger batch: seq 3 already seen, seq 2 must still pass.
    assert s.is_new(("sense-1", 2))
    print("selftest ok")


def secret(name):
    """Single source of truth for the token/URL: the same gitignored header the
    firmware compiles against. A second copy in this file is a second thing to
    forget to update when the token rotates."""
    m = re.search(rf'^\s*#define\s+{name}\s+"([^"]*)"', SECRETS.read_text(), re.M)
    if not m:
        sys.exit(f"{SECRETS}: no #define {name}")
    return m.group(1)


def api(path, token, payload=None, method=None):
    url = secret("SAPLINK_API_BASE").rstrip("/") + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"))
    req.add_header("Authorization", "Bearer " + token)
    if data:
        req.add_header("Content-Type", "application/json")
    # HTTPError is swallowed into a status rather than raised: /api/alerts/pending
    # answers 404 "nothing pending" on an IDLE queue, which is the normal case
    # several times a minute. Letting that raise would bury real failures under
    # a 404 every poll.
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = r.read()
            return r.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        return e.code, None


def main():
    import serial

    token = secret("SAPLINK_TOKEN")
    # Bounded, not a growing set: this runs for hours on a demo table. Not a
    # monotonic high-water mark either -- a spike posts the HELD-BACK previous
    # batch at seq-1 AFTER seq, so "seq must increase" would drop exactly the
    # pre-trigger context that batch exists to carry.
    seen = Seen()
    last_poll = 0.0
    last_actuate = 0.0

    ser = serial.Serial(PORT, BAUD, timeout=1)
    print(f"# bridge {PORT} -> {secret('SAPLINK_API_BASE')} -- Ctrl-C to stop", flush=True)

    while True:
        # errors="replace": the pump's EMI makes this UART unreadable while the
        # motor runs, and a UnicodeDecodeError there would kill the bridge at
        # exactly the moment worth relaying.
        raw = ser.readline()
        line = raw.decode("utf-8", errors="replace").strip() if raw else ""

        frame = parse_frame(line)
        if frame is None:
            if line:
                print(line, flush=True)  # board's own log lines, passed through
        else:
            path, payload = frame
            if payload is None:
                # Expected, not exceptional: a garbled frame is one lost batch.
                print(f"! corrupt frame, skipped ({len(line)}B)", flush=True)
            else:
                is_batch = path == "/api/readings"
                key = (payload.get("device"), payload.get("seq")) if is_batch else None
                if key is None or seen.is_new(key):
                    try:
                        status, _ = api(path, token, payload)
                        label = key[0] if key else f"node={payload.get('node_id')}"
                        print(f"{path} {status} {label} seq={payload.get('seq', '-')}", flush=True)
                    except (urllib.error.URLError, TimeoutError) as e:
                        print(f"! {path} failed: {e}", flush=True)

        # Return leg: poll the same endpoint the board polls, ack it the same
        # way, then fire the pump over the cable.
        now = time.monotonic()
        if now - last_poll >= POLL_INTERVAL_S:
            last_poll = now
            try:
                # 404 here is an EMPTY QUEUE, the normal idle state -- not an
                # error, and not something to print once a poll.
                status, pending = api("/api/alerts/pending", token)
                if status == 200 and pending and pending.get("id") is not None:
                    alert_id = pending["id"]
                    # Ack BEFORE actuating, matching the firmware: a failed ack
                    # then costs a missed dose rather than a repeated one.
                    ack, _ = api(f"/api/alerts/{alert_id}/ack", token, payload={})
                    if ack == 200:
                        if last_actuate and now - last_actuate < MIN_ACTUATE_GAP_S:
                            print(f"cooldown, skipped id={alert_id}", flush=True)
                        else:
                            ser.write(b"p")
                            last_actuate = now
                            print(f"pump <- alert id={alert_id}", flush=True)
            except (urllib.error.URLError, TimeoutError) as e:
                print(f"! poll failed: {e}", flush=True)


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    try:
        main()
    except KeyboardInterrupt:
        pass
