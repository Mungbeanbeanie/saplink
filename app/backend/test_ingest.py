"""Run: python test_ingest.py   (or pytest test_ingest.py)

Env must be set before importing main -- it opens the DB at import time.
"""

import os
import tempfile

os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["SAPLINK_TOKEN"] = "test-token"

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

c = TestClient(app)
AUTH = {"Authorization": "Bearer test-token"}


def batch(**kw):
    b = {"device": "sense-1", "seq": 0, "t_ms": 1000, "period_ms": 100,
         "baseline_mv": 0.0, "event": None, "src": "sim", "mv": [1.0, 2.0, 3.0]}
    return {**b, **kw}


def test_roundtrip():
    assert c.post("/api/ingest", json=batch(), headers=AUTH).status_code == 200
    body = c.get("/api/samples?since_id=0").json()
    s = body["samples"]
    assert len(s) == 3, s
    # t_ms must be reconstructed as t_ms + i*period_ms
    assert [x["t_ms"] for x in s] == [1000, 1100, 1200]
    assert body["last_id"] == s[0]["batch_id"]


def test_bad_token():
    assert c.post("/api/ingest", json=batch(), headers={"Authorization": "Bearer nope"}).status_code == 401
    assert c.post("/api/ingest", json=batch()).status_code == 401


def test_out_of_range_rejected():
    assert c.post("/api/ingest", json=batch(mv=[9999.0]), headers=AUTH).status_code == 422
    assert c.post("/api/ingest", json=batch(src="lies"), headers=AUTH).status_code == 422


def test_events_filtered():
    before = len(c.get("/api/events?since_id=0").json()["events"])
    c.post("/api/ingest", json=batch(seq=1, event=None), headers=AUTH)
    c.post("/api/ingest", json=batch(seq=2, event="spike"), headers=AUTH)
    evs = c.get("/api/events?since_id=0").json()["events"]
    assert len(evs) == before + 1, evs


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
