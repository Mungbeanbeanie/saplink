#!/usr/bin/env python3
"""Timestamped serial logger for the capture runs.

`pio device monitor` refuses to run with a pipe ("requires an interactive
terminal on stdin"), so it cannot tee to a log -- and the capture protocol needs
a log, because tools/analyze_events.py matches events by the `seq` the board
prints. `stty raw` + `cat` gets the bytes but fragments them mid-line.
readline() on a pyserial port frames them correctly.

pyserial is not in system python3, but it ships inside PlatformIO's venv, so run
this with that interpreter -- no new dependency to install:

    ~/.platformio/penv/bin/python tools/serial_log.py | tee ~/saplink-capture/serial.log

Ctrl-C to stop.
"""

import sys
import time

import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "/dev/cu.usbserial-0001"
BAUD = int(sys.argv[2]) if len(sys.argv) > 2 else 115200


def main():
    # cu.* not tty.*: the call-up device does not block waiting for DCD, which
    # is what makes an already-running board readable without a carrier.
    with serial.Serial(PORT, BAUD, timeout=1) as ser:
        print(f"# {PORT} @ {BAUD} -- Ctrl-C to stop", flush=True)
        while True:
            raw = ser.readline()
            if not raw:
                continue  # 1s read timeout, board is just between batches
            # errors="replace": the motor's EMI makes serial unreadable while
            # the pump runs (pump_main.cpp measured 84-440KB of framing garbage
            # per run), and a UnicodeDecodeError there would kill the log at
            # exactly the moment worth recording.
            line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
            print(f"{time.strftime('%H:%M:%S')} {line}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except serial.SerialException as e:
        sys.exit(f"serial: {e}\nIs another monitor holding {PORT}?")
