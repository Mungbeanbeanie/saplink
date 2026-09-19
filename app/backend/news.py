"""Ecology news ingestion -- backend only, no frontend consumer yet.

Split out of main.py on purpose (main.py's own docstring already calls this
out as an escape hatch: "split back out if it gets unwieldy"). Fetching
third-party RSS and running a background thread is a self-contained concern,
orthogonal to request handling -- unlike the rest of this backend's hand-built
JSON, RSS/Atom has real dialect/date-format/encoding variance across
publishers, which is exactly what feedparser is for.
"""

import calendar
import sqlite3
import threading
import time

import feedparser

# Verified by actually fetching each URL, not guessed -- one candidate
# (sciencedaily's earth_climate/environment.xml) 404s and is deliberately not
# used; this one does.
NEWS_FEEDS = [
    ("mongabay", "https://news.mongabay.com/feed/"),
    ("guardian-environment", "https://www.theguardian.com/environment/rss"),
    ("yale-e360", "https://e360.yale.edu/feed.xml"),
    ("grist", "https://grist.org/feed/"),
    ("sciencedaily-earth-climate", "https://www.sciencedaily.com/rss/earth_climate.xml"),
]


def ensure_table(db: sqlite3.Connection) -> None:
    db.execute(
        """CREATE TABLE IF NOT EXISTS news(
             id INTEGER PRIMARY KEY, source TEXT, guid TEXT UNIQUE, title TEXT,
             link TEXT, summary TEXT, published_ts REAL, fetched_ts REAL)"""
    )
    db.commit()


def _published_ts(entry) -> float | None:
    parsed = getattr(entry, "published_parsed", None)
    if not parsed:
        return None
    try:
        return float(calendar.timegm(parsed))
    except (TypeError, ValueError):
        return None


def refresh_news(db: sqlite3.Connection) -> int:
    """Fetch every feed, insert new entries. Returns count of new rows.

    One dead/slow/malformed feed must not block the others or crash the
    caller -- each feed is wrapped individually.
    """
    inserted = 0
    fetched_ts = time.time()
    for source, url in NEWS_FEEDS:
        try:
            parsed = feedparser.parse(url)
            for entry in parsed.entries:
                guid = getattr(entry, "id", None) or getattr(entry, "link", None)
                if not guid:
                    continue  # nothing to dedup on -- skip rather than risk duplicates
                cur = db.execute(
                    "INSERT OR IGNORE INTO news(source,guid,title,link,summary,"
                    "published_ts,fetched_ts) VALUES(?,?,?,?,?,?,?)",
                    (source, guid, getattr(entry, "title", ""),
                     getattr(entry, "link", ""), getattr(entry, "summary", ""),
                     _published_ts(entry), fetched_ts),
                )
                inserted += cur.rowcount
        except Exception:
            # A bad feed today shouldn't lose the other 4, or kill the
            # background thread outright.
            continue
    db.commit()
    return inserted


def start_background_refresh(db: sqlite3.Connection, interval_s: int) -> None:
    if interval_s <= 0:
        return  # tests/CI set this to 0 to avoid real outbound HTTP calls

    def loop():
        while True:
            try:
                refresh_news(db)
            except Exception:
                pass  # one bad cycle must not kill the thread
            time.sleep(interval_s)

    threading.Thread(target=loop, daemon=True).start()
