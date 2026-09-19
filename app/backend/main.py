"""Saplink ingest + read API.

One file, SQLite, no ORM. Served from api.<domain> on its own box, so routes need
no /api prefix. The ESP32 POSTs batches to /ingest; the dashboard polls /samples
with the last_id it saw.
"""

import hmac
import json
import os
import sqlite3
import time
from typing import Annotated, Literal, Optional

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DB_PATH = os.environ.get("DB_PATH", "saplink.db")
TOKEN = os.environ.get("SAPLINK_TOKEN", "dev-token")
WEB_ORIGINS = [o for o in os.environ.get("SAPLINK_WEB_ORIGIN", "").split(",") if o]

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

COLS = "id,device,t_ms,period_ms,baseline_mv,event,src,mv"


def _auth(authorization: Optional[str]) -> None:
    scheme, _, tok = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(tok, TOKEN):
        raise HTTPException(401, "bad token")


def _rows(since_id: int, limit: int, only_events: bool):
    q = f"SELECT {COLS} FROM batch WHERE id>?"
    if only_events:
        q += " AND event IS NOT NULL"
    return db.execute(q + " ORDER BY id LIMIT ?", (since_id, limit)).fetchall()


@app.post("/ingest")
def ingest(b: Batch, authorization: Annotated[Optional[str], Header()] = None):
    _auth(authorization)
    cur = db.execute(
        "INSERT INTO batch(recv_ts,device,seq,t_ms,period_ms,baseline_mv,event,src,mv)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        (time.time(), b.device, b.seq, b.t_ms, b.period_ms, b.baseline_mv,
         b.event, b.src, json.dumps(b.mv)),
    )
    db.commit()
    return {"id": cur.lastrowid, "n": len(b.mv)}


@app.get("/samples")
def samples(since_id: int = 0, limit: Annotated[int, Query(ge=1, le=2000)] = 200):
    """Flattened samples. `limit` counts BATCHES (~32 samples each), not samples."""
    out, last = [], since_id
    for bid, device, t_ms, period_ms, baseline, event, src, mv in _rows(since_id, limit, False):
        last = bid
        for i, v in enumerate(json.loads(mv)):
            out.append({
                "batch_id": bid, "device": device, "t_ms": t_ms + i * period_ms,
                "mv": v, "baseline_mv": baseline, "event": event, "src": src,
            })
    return {"last_id": last, "samples": out}


@app.get("/events")
def events(since_id: int = 0, limit: Annotated[int, Query(ge=1, le=1000)] = 100):
    out, last = [], since_id
    for bid, device, t_ms, _period, baseline, event, src, _mv in _rows(since_id, limit, True):
        last = bid
        out.append({
            "batch_id": bid, "device": device, "t_ms": t_ms,
            "event": event, "baseline_mv": baseline, "src": src,
        })
    return {"last_id": last, "events": out}


@app.get("/health")
def health():
    n, last_recv = db.execute("SELECT COUNT(*), MAX(recv_ts) FROM batch").fetchone()
    devices = [r[0] for r in db.execute("SELECT DISTINCT device FROM batch")]
    return {"ok": True, "batches": n, "last_recv": last_recv, "devices": devices}
