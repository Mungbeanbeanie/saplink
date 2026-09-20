"""Saplink API -- readings telemetry plus the alert control plane.

One file, SQLite, no ORM. The ESP32 POSTs sample batches to /api/readings and
discrete events to /api/alerts; it then polls /api/alerts/pending to find out
whether to run the pump. The dashboard polls /api/readings/history with the
last_id it saw.

Two tables, two contracts, deliberately not merged. Contract A (batch) is the
continuous waveform: many samples, no state. Contract B (alert) is a discrete
event with an ack state machine driving a physical actuator. They answer
different questions and one row of one is never a row of the other.

NOT here, on purpose: POST /api/alerts/manual. It existed only to fake an event
for the demo, and the firmware's serial 'r' key does that better by driving the
real detector instead of bypassing it. Its absence is also why nothing in this
file except /api/auth/me sits behind _google_user -- no browser-reachable write
can run the pump.
"""

import hmac
import json
import os
import sqlite3
import time
from typing import Annotated, Literal, Optional

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel, Field

import news

DB_PATH = os.environ.get("DB_PATH", "saplink.db")
TOKEN = os.environ.get("SAPLINK_TOKEN", "dev-token")
WEB_ORIGINS = [o for o in os.environ.get("SAPLINK_WEB_ORIGIN", "").split(",") if o]
# 30 min default; tests/CI set this to 0 so `python test_ingest.py` never makes
# real outbound HTTP calls to the news feeds.
NEWS_REFRESH_SECONDS = int(os.environ.get("NEWS_REFRESH_SECONDS", "1800"))
# ARBITRARY starting heuristic for the dashboard's site-map density score --
# no real deployment-scale target is documented anywhere yet. Tune via env
# var without a code change; revisit once a real target device count exists.
NETWORK_TARGET_DEVICES = int(os.environ.get("NETWORK_TARGET_DEVICES", "8"))

# Browser identity, entirely separate from TOKEN above -- see _google_user().
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
# empty = any Google account passes; still a real verified identity
ALLOWED_EMAILS = {e.strip().lower()
                  for e in os.environ.get("SAPLINK_ALLOWED_EMAILS", "").split(",")
                  if e.strip()}

db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.execute("PRAGMA journal_mode=WAL")
# ponytail: mv is a JSON blob column, not a normalized samples table. Split it
# out if queries get slow -- they won't at 10 Hz for a weekend.
db.execute(
    """CREATE TABLE IF NOT EXISTS batch(
         id INTEGER PRIMARY KEY, recv_ts REAL, device TEXT, seq INTEGER,
         t_ms INTEGER, period_ms INTEGER, baseline_mv REAL, event TEXT,
         src TEXT, mv TEXT)"""
)
# Contract B. Separate table because an alert is a discrete event with state
# (acked), not a slice of waveform -- see the module docstring.
db.execute(
    """CREATE TABLE IF NOT EXISTS alert(
         id INTEGER PRIMARY KEY, created_ts REAL, node_id INTEGER,
         event_type TEXT, voltage_mv REAL, threshold_mv REAL,
         timestamp_ms INTEGER, acked INTEGER DEFAULT 0)"""
)
# These arrived after the first deployments, and CREATE TABLE IF NOT EXISTS
# will not add a column to a table that already exists -- so an existing
# saplink.db needs these or every insert fails on an unknown column.
for _col in ("soil_mv INTEGER", "replay INTEGER", "raw_mv TEXT"):
    try:
        db.execute(f"ALTER TABLE batch ADD COLUMN {_col}")
    except sqlite3.OperationalError:
        pass  # column already there; ALTER is the only way to ask
db.commit()
news.ensure_table(db)

Millivolts = Annotated[float, Field(ge=-5000, le=5000)]


class Batch(BaseModel):
    """The frozen wire format. Changing this breaks the firmware -- don't."""

    device: str = Field(max_length=32)
    seq: int = Field(ge=0)          # monotonic per boot; gaps mean dropped batches
    t_ms: int = Field(ge=0)         # millis() at the FIRST sample
    period_ms: int = Field(ge=1, le=60_000)
    baseline_mv: Millivolts
    event: Optional[Literal["spike"]] = None
    src: Literal["sim", "ads1115"]  # "sim" until an ADC is actually wired
    mv: list[Millivolts] = Field(max_length=256)
    # Raw ADC millivolts off the soil probe, NOT a moisture percentage -- that
    # conversion needs a two-point calibration of the physical probe and does
    # not belong in the wire format. Optional with a default so firmware built
    # before this field still validates: additive, so the contract above stays
    # frozen rather than changed.
    soil_mv: Optional[int] = Field(default=None, ge=0, le=5000)
    # True when RecordedSignalPlayer superimposed a waveform onto this batch.
    # src stays "ads1115" because the ADC really is live, so without a separate
    # flag an injected spike is indistinguishable from a real one on stage.
    replay: bool = False
    # What the ADC actually produced, before conditioning. NOT recoverable from
    # mv[]: deviation() = filtered - baseline, so baseline_mv + mv[i] gives back
    # the MEDIAN-FILTERED value, not the raw one. Same reasoning as soil_mv --
    # keep raw in the DB so a bad derivation is re-derivable without re-running
    # the experiment. On a replay batch this is pre-injection, so raw_mv and mv
    # disagree by exactly the injected waveform and `replay` says why.
    raw_mv: Optional[list[Millivolts]] = Field(default=None, max_length=256)


class AlertIn(BaseModel):
    """Contract B. Field names must match packet_schema.h EXACTLY.

    The firmware hand-builds this JSON with snprintf in CloudClient::postAlert;
    there is no code generation between the two languages, so a rename here
    silently stops parsing there.
    """

    node_id: int = Field(ge=0, le=255)   # ORIGIN -- who raised it, not who acts
    event_type: Literal["VP_SPIKE", "REPLAY_TRIGGER"]
    voltage_mv: Millivolts               # peak deviation that fired the detector
    threshold_mv: Millivolts             # 3*sigma at fire time, measured
    # millis() on the board, NOT epoch ms: the firmware parses this back with
    # sscanf("%ld") into a 32-bit long, which epoch milliseconds overflow.
    timestamp_ms: int = Field(ge=0)


app = FastAPI(title="saplink")

# The frontend lives on a different box, so browser calls are cross-origin.
# CORS is a browser courtesy, NOT the auth boundary -- the bearer token is. The
# ESP32 is not a browser and never sends a preflight.
app.add_middleware(
    CORSMiddleware,
    allow_origins=WEB_ORIGINS or ["http://localhost:8080"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

COLS = "id,device,t_ms,period_ms,baseline_mv,event,src,mv,soil_mv,seq,replay,raw_mv"

# Ordered so "id" is the first key in the pending-alert JSON. strstr for
# '"id":' cannot match inside '"node_id":' anyway -- the underscore blocks the
# leading quote -- but the firmware's parser is positional-ish enough that
# leaning on that is not worth it.
ALERT_COLS = "id,node_id,event_type,voltage_mv,threshold_mv,timestamp_ms"


def _auth(authorization: Optional[str]) -> None:
    scheme, _, tok = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(tok, TOKEN):
        raise HTTPException(401, "bad token")


def _google_user(authorization: Optional[str]) -> str:
    """Browser identity. NOT the device path -- _auth() owns that, unchanged.

    Two callers, two credentials: the ESP32 carries a shared SAPLINK_TOKEN, a
    person carries a Google ID token. Do not merge the checks.
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(503, "GOOGLE_CLIENT_ID not configured")
    scheme, _, tok = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not tok:
        raise HTTPException(401, "missing bearer token")
    try:
        # Request() per call on purpose: requests.Session isn't thread-safe and
        # uvicorn runs sync handlers on a threadpool. google-auth caches Google's
        # certs at module level, so this costs nothing after the first call.
        claims = id_token.verify_oauth2_token(
            tok, google_requests.Request(), GOOGLE_CLIENT_ID)
    except ValueError as e:
        raise HTTPException(401, f"bad google token: {e}")
    except Exception as e:
        # transport/cert-fetch failure is ours, not the caller's -- don't report
        # "your token is bad" when Google was just unreachable
        raise HTTPException(503, f"token verification unavailable: {e}")
    email = (claims.get("email") or "").lower()
    if ALLOWED_EMAILS and email not in ALLOWED_EMAILS:
        raise HTTPException(403, "not allowed")
    return email


def _rows(since_id: int, limit: int):
    return db.execute(
        f"SELECT {COLS} FROM batch WHERE id>? ORDER BY id LIMIT ?", (since_id, limit)
    ).fetchall()


@app.post("/api/readings")
def ingest(b: Batch, authorization: Annotated[Optional[str], Header()] = None):
    _auth(authorization)
    cur = db.execute(
        "INSERT INTO batch(recv_ts,device,seq,t_ms,period_ms,baseline_mv,event,src,mv,"
        "soil_mv,replay,raw_mv) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (time.time(), b.device, b.seq, b.t_ms, b.period_ms, b.baseline_mv,
         b.event, b.src, json.dumps(b.mv), b.soil_mv, int(b.replay),
         json.dumps(b.raw_mv) if b.raw_mv is not None else None),
    )
    db.commit()
    return {"id": cur.lastrowid, "n": len(b.mv)}


def _flatten(row):
    (bid, device, t_ms, period_ms, baseline, event, src, mv, soil_mv, seq,
     replay, raw_mv) = row
    # soil_mv/seq/replay are per-batch, not per-sample, and ride along on each
    # flattened sample exactly as baseline_mv/event/src already do -- the
    # dashboard reads whichever sample it is drawing and gets the batch context
    # with it. seq lets it detect dropped batches (gaps in the seq sequence).
    raw = json.loads(raw_mv) if raw_mv else []
    return [{"batch_id": bid, "device": device, "t_ms": t_ms + i * period_ms,
             "mv": v, "baseline_mv": baseline, "event": event, "src": src,
             "soil_mv": soil_mv, "seq": seq, "replay": bool(replay),
             # Bounds-checked rather than zipped: a short raw_mv must not
             # silently pair sample i's mv with some other sample's raw value.
             # Absent or short -> None, never a misaligned number.
             "raw_mv": raw[i] if i < len(raw) else None}
            for i, v in enumerate(json.loads(mv))]


@app.get("/api/readings/history")
def history(since_id: int = 0, limit: Annotated[int, Query(ge=1, le=2000)] = 200):
    """Flattened samples. `limit` counts BATCHES (~32 samples each), not samples."""
    out, last = [], since_id
    for row in _rows(since_id, limit):
        last = row[0]
        out += _flatten(row)
    return {"last_id": last, "samples": out}


@app.get("/api/readings/latest")
def latest():
    """Most recent single sample, for the dashboard's live panel + alert banner."""
    row = db.execute(f"SELECT {COLS} FROM batch ORDER BY id DESC LIMIT 1").fetchone()
    if row is None:
        return {"last_id": 0, "sample": None}
    return {"last_id": row[0], "sample": _flatten(row)[-1]}


# ---------------------------------------------------------------- Contract B

def _alert_json(row) -> dict:
    return dict(zip(ALERT_COLS.split(","), row))


def _raise_alert(a: AlertIn) -> int:
    """Insert an alert, unless one is already waiting to be acted on.

    ponytail: one un-acked alert at a time, enforced here rather than in each
    caller. A noisy electrode firing on consecutive batches would otherwise
    queue doses the pump delivers back to back, and this is the single point
    every alert-creating path routes through.
    """
    row = db.execute("SELECT id FROM alert WHERE acked=0 ORDER BY id LIMIT 1").fetchone()
    if row:
        return row[0]
    cur = db.execute(
        "INSERT INTO alert(created_ts,node_id,event_type,voltage_mv,threshold_mv,"
        "timestamp_ms) VALUES(?,?,?,?,?,?)",
        (time.time(), a.node_id, a.event_type, a.voltage_mv, a.threshold_mv,
         a.timestamp_ms),
    )
    db.commit()
    return cur.lastrowid


@app.post("/api/alerts")
def post_alert(a: AlertIn, authorization: Annotated[Optional[str], Header()] = None):
    """The board reports a detected event. Device token, same as /api/readings."""
    _auth(authorization)
    return {"id": _raise_alert(a)}


@app.get("/api/alerts")
def alerts(since_id: int = 0, limit: Annotated[int, Query(ge=1, le=2000)] = 200):
    """Event history. Public, like /api/readings/* -- a read path must never be
    able to kill the dashboard on stage behind an auth failure."""
    rows = db.execute(
        f"SELECT {ALERT_COLS},acked,created_ts FROM alert WHERE id>? ORDER BY id LIMIT ?",
        (since_id, limit),
    ).fetchall()
    out = [{**_alert_json(r[:-2]), "acked": bool(r[-2]), "created_ts": r[-1]}
           for r in rows]
    return {"last_id": out[-1]["id"] if out else since_id, "alerts": out}


@app.get("/api/alerts/pending")
def pending_alert(authorization: Annotated[Optional[str], Header()] = None):
    """Oldest un-acked alert, or 404.

    404 rather than 200-with-null on purpose: CloudClient::pollPendingAlert
    treats any non-200 as "nothing pending", so an empty queue and a transport
    failure land on the same harmless branch.

    ponytail: returns the oldest un-acked alert whatever raised it -- one board
    is both ends of the route today, so the loopback IS the demo. A dedicated
    plant-2 board wants a target filter here.
    """
    _auth(authorization)
    row = db.execute(
        f"SELECT {ALERT_COLS} FROM alert WHERE acked=0 ORDER BY id LIMIT 1"
    ).fetchone()
    if row is None:
        raise HTTPException(404, "nothing pending")
    return _alert_json(row)


@app.post("/api/alerts/{alert_id}/ack")
def ack_alert(alert_id: int, authorization: Annotated[Optional[str], Header()] = None):
    """Claim an alert so it cannot fire the pump twice."""
    _auth(authorization)
    cur = db.execute("UPDATE alert SET acked=1 WHERE id=? AND acked=0", (alert_id,))
    db.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, "no such un-acked alert")
    return {"ok": True, "id": alert_id}


@app.get("/api/auth/me")
def me(authorization: Annotated[Optional[str], Header()] = None):
    """Frontend validates a token once and renders 'signed in as X'.

    Still the only route using _google_user, and now deliberately so: the alert
    plane above is device-token only, so no browser-reachable write can run the
    pump. See the module docstring on the dropped /api/alerts/manual.
    """
    return {"email": _google_user(authorization)}


@app.get("/api/health")
def health():
    n, last_recv = db.execute("SELECT COUNT(*), MAX(recv_ts) FROM batch").fetchone()
    devices = [r[0] for r in db.execute("SELECT DISTINCT device FROM batch")]
    return {"ok": True, "batches": n, "last_recv": last_recv, "devices": devices}


@app.get("/api/network")
def network():
    """Per-device recent activity + an overall density score, for the
    dashboard's site map. Public, like /api/health -- a read path must never
    be gated. The map does NOT render one node per real device (see
    NETWORK_TARGET_DEVICES above and plan.md's Phase 6 note) -- this just
    hands the frontend real numbers to size and light that graph with."""
    devices = [r[0] for r in db.execute("SELECT DISTINCT device FROM batch")]
    nodes = []
    for d in devices:
        row = db.execute(
            "SELECT recv_ts, mv FROM batch WHERE device=? ORDER BY id DESC LIMIT 1",
            (d,),
        ).fetchone()
        if row is None:
            continue
        recv_ts, mv_json = row
        # mv[] is already baseline-subtracted deviation (firmware's
        # cond.deviation()), so the largest magnitude in the latest batch is
        # directly "how far from resting, right now" -- no extra math needed.
        mv = json.loads(mv_json)
        activity = max((abs(v) for v in mv), default=0.0)
        nodes.append({"device": d, "last_recv": recv_ts, "activity": round(activity, 3)})
    density = min(1.0, len(devices) / NETWORK_TARGET_DEVICES)
    return {"density": density, "nodes": nodes}


# ------------------------------------------------------------- Ecology news

NEWS_COLS = "id,source,title,link,summary,published_ts"


@app.on_event("startup")
def _start_news_refresh():
    news.start_background_refresh(db, NEWS_REFRESH_SECONDS)


@app.get("/api/news")
def news_items(limit: Annotated[int, Query(ge=1, le=200)] = 20):
    """Public, like /api/readings/* -- a read path must never be gated."""
    rows = db.execute(
        f"SELECT {NEWS_COLS} FROM news ORDER BY COALESCE(published_ts, fetched_ts) "
        "DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return {"items": [dict(zip(NEWS_COLS.split(","), r)) for r in rows]}


@app.post("/api/news/refresh")
def news_refresh(authorization: Annotated[Optional[str], Header()] = None):
    """Manual/on-demand trigger, device-token gated so a stranger can't spam
    outbound requests to 5 external news sites through this server."""
    _auth(authorization)
    return {"inserted": news.refresh_news(db)}
