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


def alert(**kw):
    a = {"node_id": 1, "event_type": "VP_SPIKE", "voltage_mv": 42.0,
         "threshold_mv": 0.093, "timestamp_ms": 12345}
    return {**a, **kw}


def _drain():
    """Ack whatever is pending so each alert test starts from an empty queue."""
    while True:
        r = c.get("/api/alerts/pending", headers=AUTH)
        if r.status_code == 404:
            return
        c.post(f"/api/alerts/{r.json()['id']}/ack", headers=AUTH)


def test_alert_roundtrip():
    _drain()
    aid = c.post("/api/alerts", json=alert(), headers=AUTH).json()["id"]
    got = [a for a in c.get("/api/alerts").json()["alerts"] if a["id"] == aid]
    assert len(got) == 1, got
    assert got[0]["event_type"] == "VP_SPIKE" and got[0]["node_id"] == 1, got[0]
    # threshold_mv is measured on the board, not a placeholder -- it must survive
    assert got[0]["threshold_mv"] == 0.093, got[0]


def test_alert_bad_token():
    assert c.post("/api/alerts", json=alert(), headers={"Authorization": "Bearer nope"}).status_code == 401
    assert c.post("/api/alerts", json=alert()).status_code == 401


def test_alert_bad_event_type():
    assert c.post("/api/alerts", json=alert(event_type="LEAF_WIGGLE"), headers=AUTH).status_code == 422
    assert c.post("/api/alerts", json=alert(node_id=999), headers=AUTH).status_code == 422


def test_replay_trigger_event_type():
    # serial 'r' posts REPLAY_TRIGGER, a real stimulus posts VP_SPIKE -- both
    # must survive the round trip or an injected event looks real on the dashboard
    _drain()
    aid = c.post("/api/alerts", json=alert(event_type="REPLAY_TRIGGER"), headers=AUTH).json()["id"]
    got = next(a for a in c.get("/api/alerts").json()["alerts"] if a["id"] == aid)
    assert got["event_type"] == "REPLAY_TRIGGER", got


def test_pending_then_ack():
    _drain()
    aid = c.post("/api/alerts", json=alert(), headers=AUTH).json()["id"]
    p = c.get("/api/alerts/pending", headers=AUTH)
    assert p.status_code == 200 and p.json()["id"] == aid, p.text
    assert c.post(f"/api/alerts/{aid}/ack", headers=AUTH).status_code == 200
    # 404, not 200-with-null: pollPendingAlert treats any non-200 as "nothing"
    assert c.get("/api/alerts/pending", headers=AUTH).status_code == 404
    # acking twice must not resurrect it
    assert c.post(f"/api/alerts/{aid}/ack", headers=AUTH).status_code == 404


def test_alert_dedupe_while_unacked():
    # The guard that stops a noisy electrode queueing doses the pump delivers
    # back to back. Second POST returns the FIRST id and inserts nothing.
    _drain()
    first = c.post("/api/alerts", json=alert(), headers=AUTH).json()["id"]
    before = len(c.get("/api/alerts").json()["alerts"])
    second = c.post("/api/alerts", json=alert(voltage_mv=99.0), headers=AUTH).json()["id"]
    assert second == first, (first, second)
    assert len(c.get("/api/alerts").json()["alerts"]) == before


def test_alert_reads_stay_public():
    assert c.get("/api/alerts").status_code == 200
    # ...but the pump-adjacent routes do not
    assert c.get("/api/alerts/pending").status_code == 401


def test_replay_flag_roundtrip():
    r = c.post("/api/readings", json=batch(seq=20, replay=True), headers=AUTH)
    bid = r.json()["id"]
    s = c.get(f"/api/readings/history?since_id={bid - 1}&limit=1").json()["samples"]
    assert all(x["replay"] is True for x in s), s
    # default stays False for firmware that predates the field
    r = c.post("/api/readings", json=batch(seq=21), headers=AUTH)
    bid = r.json()["id"]
    s = c.get(f"/api/readings/history?since_id={bid - 1}&limit=1").json()["samples"]
    assert all(x["replay"] is False for x in s), s


def test_raw_mv_roundtrip():
    r = c.post("/api/readings", json=batch(seq=22, mv=[1.0, 2.0, 3.0],
                                           raw_mv=[31.0, 32.0, 33.0]), headers=AUTH)
    bid = r.json()["id"]
    s = c.get(f"/api/readings/history?since_id={bid - 1}&limit=1").json()["samples"]
    # paired per-sample with mv, not collapsed onto the batch
    assert [x["raw_mv"] for x in s] == [31.0, 32.0, 33.0], s
    assert [x["mv"] for x in s] == [1.0, 2.0, 3.0], s


def test_raw_mv_optional():
    r = c.post("/api/readings", json=batch(seq=23), headers=AUTH)
    bid = r.json()["id"]
    s = c.get(f"/api/readings/history?since_id={bid - 1}&limit=1").json()["samples"]
    assert all(x["raw_mv"] is None for x in s), s


def test_raw_mv_short_does_not_misalign():
    # A truncated raw array must yield None, never sample i paired with some
    # other sample's raw value. Must not 422 either -- a live board mid-demo
    # keeps ingesting.
    r = c.post("/api/readings", json=batch(seq=24, mv=[1.0, 2.0, 3.0],
                                           raw_mv=[31.0]), headers=AUTH)
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    s = c.get(f"/api/readings/history?since_id={bid - 1}&limit=1").json()["samples"]
    assert [x["raw_mv"] for x in s] == [31.0, None, None], s


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
