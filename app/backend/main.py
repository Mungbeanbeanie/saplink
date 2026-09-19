"""Saplink readings API -- the telemetry half of the backend.

One file, SQLite, no ORM. The ESP32 POSTs sample batches to /api/readings; the
dashboard polls /api/readings/history with the last_id it saw.

Scope boundary: this owns READINGS only. The alert control plane that plan.md
Phase 5 describes (POST /api/alerts, /api/alerts/pending, /api/alerts/{id}/ack,
/api/alerts/manual) is a separate concern and is NOT implemented here -- it
carries its own schema (node_id/event_type/voltage_mv/threshold_mv/timestamp_ms)
and an ack state machine. plan.md declared the /api/readings/* routes without a
backing model; this file is that model.
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

DB_PATH = os.environ.get("DB_PATH", "saplink.db")
TOKEN = os.environ.get("SAPLINK_TOKEN", "dev-token")
WEB_ORIGINS = [o for o in os.environ.get("SAPLINK_WEB_ORIGIN", "").split(",") if o]

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
# soil_mv arrived after the first deployments, and CREATE TABLE IF NOT EXISTS
# will not add a column to a table that already exists -- so an existing
# saplink.db needs this or every insert fails on an unknown column.
try:
    db.execute("ALTER TABLE batch ADD COLUMN soil_mv INTEGER")
except sqlite3.OperationalError:
    pass  # column already there; ALTER is the only way to ask
db.commit()

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

COLS = "id,device,t_ms,period_ms,baseline_mv,event,src,mv,soil_mv"


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
        "soil_mv) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (time.time(), b.device, b.seq, b.t_ms, b.period_ms, b.baseline_mv,
         b.event, b.src, json.dumps(b.mv), b.soil_mv),
    )
    db.commit()
    return {"id": cur.lastrowid, "n": len(b.mv)}


def _flatten(row):
    bid, device, t_ms, period_ms, baseline, event, src, mv, soil_mv = row
    # soil_mv is per-batch, not per-sample, and rides along on each flattened
    # sample exactly as baseline_mv/event/src already do -- the dashboard reads
    # whichever sample it is drawing and gets the batch context with it.
    return [{"batch_id": bid, "device": device, "t_ms": t_ms + i * period_ms,
             "mv": v, "baseline_mv": baseline, "event": event, "src": src,
             "soil_mv": soil_mv}
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


@app.get("/api/auth/me")
def me(authorization: Annotated[Optional[str], Header()] = None):
    """Frontend validates a token once and renders 'signed in as X'.

    The only route using _google_user today -- hang it off POST
    /api/alerts/manual too once the alert control plane exists.
    """
    return {"email": _google_user(authorization)}


@app.get("/api/health")
def health():
    n, last_recv = db.execute("SELECT COUNT(*), MAX(recv_ts) FROM batch").fetchone()
    devices = [r[0] for r in db.execute("SELECT DISTINCT device FROM batch")]
    return {"ok": True, "batches": n, "last_recv": last_recv, "devices": devices}
