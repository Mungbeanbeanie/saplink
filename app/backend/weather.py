"""Blacksburg current temperature via Open-Meteo -- free, no API key, no
sign-up. Hardcoded lat/lon: no dynamic per-router location exists anywhere in
this system yet (the site graph/roster have no real GPS either -- see
plan.md's Weather note), and the user explicitly scoped this pass to a single
fixed location. Swap in a real per-router location once one exists.

Same background-refresh-thread shape as news.py: an external fetch is a
self-contained concern, orthogonal to request handling. Unlike news.py this
keeps no DB table -- it's one current value, not an accumulating history, so
an in-memory cache is enough.

Uses `requests`, not stdlib urllib -- urllib.request relies on the system's
own CA trust store, which is unreliable across environments (confirmed: it
fails locally on a python.org macOS install missing linked root certs).
`requests` ships its own CA bundle via `certifi` and already works in this
exact deployment (`google.auth.transport.requests` uses it for the same
reason). Not a new dependency: `google-auth[requests]` in requirements.txt
already pulls it in transitively, but it's added explicitly there too now so
this file doesn't depend on an undeclared transitive package.
"""

import threading
import time

import requests

# Blacksburg, VA -- Virginia Tech's home.
LATITUDE = 37.2296
LONGITUDE = -80.4139
URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={LATITUDE}&longitude={LONGITUDE}"
    "&current=temperature_2m&temperature_unit=fahrenheit&timezone=America%2FNew_York"
)

_lock = threading.Lock()
_state = {"temperature_f": None, "fetched_ts": None, "ok": False}


def refresh_weather() -> None:
    """One fetch. Never raises -- a bad/slow weather API must not take down
    ingestion or any other route; the last good reading (or None) just keeps
    being served, same reasoning as news.py's per-feed try/except."""
    try:
        data = requests.get(URL, timeout=5).json()
        temp = data["current"]["temperature_2m"]
        with _lock:
            _state["temperature_f"] = temp
            _state["fetched_ts"] = time.time()
            _state["ok"] = True
    except Exception:
        with _lock:
            _state["ok"] = False


def current() -> dict:
    with _lock:
        return dict(_state)


def start_background_refresh(interval_s: int) -> None:
    if interval_s <= 0:
        return  # tests/CI set this to 0 to avoid real outbound HTTP calls

    def loop():
        while True:
            refresh_weather()
            time.sleep(interval_s)

    threading.Thread(target=loop, daemon=True).start()
