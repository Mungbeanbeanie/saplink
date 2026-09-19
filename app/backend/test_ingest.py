"""Run: python test_ingest.py   (or pytest test_ingest.py)

Env must be set before importing main -- it opens the DB at import time.
"""

import os
import tempfile

os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["SAPLINK_TOKEN"] = "test-token"
os.environ["GOOGLE_CLIENT_ID"] = "test-client-id"

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

c = TestClient(app)
AUTH = {"Authorization": "Bearer test-token"}


def batch(**kw):
    b = {"device": "sense-1", "seq": 0, "t_ms": 1000, "period_ms": 100,
         "baseline_mv": 0.0, "event": None, "src": "sim", "mv": [1.0, 2.0, 3.0]}
    return {**b, **kw}


def test_roundtrip():
    r = c.post("/api/readings", json=batch(), headers=AUTH)
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    # since_id=bid-1 so this reads only our own batch, whatever else is in the db
    body = c.get(f"/api/readings/history?since_id={bid - 1}&limit=1").json()
    s = body["samples"]
    assert len(s) == 3, s
    # t_ms must be reconstructed as t_ms + i*period_ms
    assert [x["t_ms"] for x in s] == [1000, 1100, 1200]
    assert body["last_id"] == bid
    assert all(x["batch_id"] == bid for x in s)


def test_bad_token():
    assert c.post("/api/readings", json=batch(), headers={"Authorization": "Bearer nope"}).status_code == 401
    assert c.post("/api/readings", json=batch()).status_code == 401


def test_out_of_range_rejected():
    assert c.post("/api/readings", json=batch(mv=[9999.0]), headers=AUTH).status_code == 422
    assert c.post("/api/readings", json=batch(src="lies"), headers=AUTH).status_code == 422


def test_latest():
    r = c.post("/api/readings", json=batch(seq=9, mv=[7.0, 8.0], event="spike"), headers=AUTH)
    bid = r.json()["id"]
    body = c.get("/api/readings/latest").json()
    assert body["last_id"] == bid, body
    # latest = the LAST sample of the newest batch, at t_ms + (n-1)*period_ms
    assert body["sample"]["mv"] == 8.0, body
    assert body["sample"]["t_ms"] == 1100, body
    assert body["sample"]["event"] == "spike", body


def test_google_garbage_token():
    # NEEDS NETWORK: google-auth fetches Google's certs before parsing, so
    # offline this is 503 ("can't check") rather than 401 ("token is bad").
    assert c.get("/api/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
    assert c.get("/api/auth/me").status_code == 401


def test_reads_stay_public():
    # guards against accidentally gating the live chart behind auth
    assert c.get("/api/readings/history").status_code == 200
    assert c.get("/api/health").status_code == 200


def test_soil_mv_roundtrip():
    r = c.post("/api/readings", json=batch(seq=11, soil_mv=2221), headers=AUTH)
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    s = c.get(f"/api/readings/history?since_id={bid - 1}&limit=1").json()["samples"]
    # per-batch value, repeated onto every flattened sample like baseline_mv
    assert all(x["soil_mv"] == 2221 for x in s), s


def test_soil_mv_optional():
    # Firmware built before soil_mv existed must keep ingesting -- that is the
    # whole reason the field is optional rather than a contract change. Every
    # other test posts without it; this one asserts that on purpose.
    r = c.post("/api/readings", json=batch(seq=12), headers=AUTH)
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    s = c.get(f"/api/readings/history?since_id={bid - 1}&limit=1").json()["samples"]
    assert all(x["soil_mv"] is None for x in s), s


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
