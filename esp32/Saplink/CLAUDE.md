# Saplink — cloud leg (ESP32 → Vultr)

Runbook for the sensing board and the two cloud boxes. `../../.claude/overview.md` stays the source of
truth for the overall system; this file covers only the cloud pipeline and the firmware that feeds it.

## Divergences from overview.md

- **One ESP32 total, nothing wired to it.** The two-node ESP-NOW relay (sense node → actuator node) in
  `overview.md` is not built. The single board senses *and* uploads over Wi-Fi. Revisit when a second
  board arrives.
- **No ADS1115, no electrodes yet.** The firmware posts a synthetic waveform tagged `"src":"sim"`.
  Swapping in real reads is one function body — see [The seam](#the-seam).

---

## Topology

```
                     ┌──────────────── saplink-api box ─────────────────┐
  ESP32 ────────────►│  Caddy :443          FastAPI :8000               │
   (dummy data)      │  api.<domain>  ────►  /ingest /samples /events   │
                     │                            │                     │
  future iOS app ───►│                       SQLite (docker volume)     │
                     └──────────────────────────────────────────────────┘
                                          ▲
                                          │ CORS: https://<domain>
                     ┌──────────────── saplink-web box ─────────────────┐
  browser ──────────►│  Caddy :443   <domain>  ──►  app/frontend/       │
                     └──────────────────────────────────────────────────┘
```

Two boxes so the backend is a standalone API — a future iOS app is just another client. Each box runs its
own Caddy for TLS. Port 8000 is never exposed; only 80/443 are open on either box.

| | role | host | repo path |
|---|---|---|---|
| `saplink-api` | FastAPI + SQLite + Caddy | `api.<domain>` | `/opt/saplink` |
| `saplink-web` | Caddy static file server | `<domain>`, `www.<domain>` | `/opt/saplink` |

---

## The contract — frozen wire format

`overview.md` calls out schema drift as a classic time-sink. Don't change these fields without telling
everyone.

**`POST https://api.<domain>/ingest`** — header `Authorization: Bearer <SAPLINK_TOKEN>`

```json
{
  "device": "sense-1",
  "seq": 42,
  "t_ms": 123456,
  "period_ms": 100,
  "baseline_mv": -11.83,
  "event": null,
  "src": "sim",
  "mv": [-12.4, -12.1, -11.9]
}
```

- `seq` — monotonic per boot. Gaps mean dropped batches.
- `t_ms` — `millis()` at the **first** sample. Sample *i* is at `t_ms + i*period_ms`.
- `src` — `"sim"` or `"ads1115"`. On stage this is how you tell live data from synthetic.
- `baseline_mv` / `event` — in the schema from day one so the sensing teammate's auto-zero and spike
  classifier land without a schema change. Firmware sends a running mean and `null` for now.

**Reads** (no auth, CORS-allowed from the web origin):

| route | returns |
|---|---|
| `GET /samples?since_id=0&limit=200` | `{"last_id", "samples":[{batch_id, device, t_ms, mv, baseline_mv, event, src}]}` — flattened from batches. **`limit` counts batches** (~32 samples each). Poll with the returned `last_id`. |
| `GET /events?since_id=0` | spike batches only |
| `GET /health` | `{"ok", "batches", "last_recv", "devices"}` |

Bounds enforced by Pydantic: `device` ≤32 chars, `period_ms` 1–60000, `mv` ≤256 items each −5000..5000 mV,
`event` ∈ {null,"spike"}, `src` ∈ {"sim","ads1115"}. Bad token → 401, malformed → 422.

---

## Firmware

```
esp32/Saplink/
  src/sensor_main.cpp     wifi + synthetic samples + HTTPS POST   <- the cloud leg
  src/diagnostic_main.cpp I2C hardware debugger
  src/actuator_main.cpp   (teammate, not written yet)
  src/combo_main.cpp      (teammate, not written yet)
  include/secrets.h       GITIGNORED — copy from secrets.h.example
  include/secrets.h.example
```

One env per `*_main.cpp` in `platformio.ini`, selected by `build_src_filter` —
they each define `setup()`/`loop()`, so exactly one builds at a time.

### Build / flash

`pio` is not on PATH, and there is **no default env** — always pass `-e`, or
PlatformIO tries to build every env including the ones whose source files don't
exist yet:

```sh
alias pio=~/.platformio/penv/bin/pio
pio run -e sensor -t upload && pio device monitor   # the cloud-leg firmware
pio run -e diagnostic -t upload                     # the I2C scanner instead
```

Healthy monitor output: `wifi ok <ip>` then a repeating `POST 200 seq=N`.

### secrets.h

Copy `include/secrets.h.example` → `include/secrets.h` and fill in. Never commit it.
`SAPLINK_URL` is `https://api.<domain>/ingest`; `SAPLINK_TOKEN` must match the API box's `.env`.

### The seam

`readMv()` in `src/sensor_main.cpp` is the **only** thing that changes when the ADS1115 is wired: replace
the body with a real read and flip `SRC` to `"ads1115"`. Nothing else in the file moves. Today it returns
slow baseline wander plus a spike every ~20 s, so the dashboard sees a realistic shape, not a flat line.

`src/diagnostic_main.cpp` is the original I2C diagnostic — pull-up detection, pin capacitance sweep,
address scan at two bus speeds. Use it the day the ADC shows up and doesn't ACK at 0x48.

### TLS

`WiFiClientSecure::setInsecure()` — cert validation is skipped. The bearer token is the real auth and TLS
still stops passive sniffing. Proper pinning needs an NTP-synced clock plus ISRG Root X1, and a
captive-portal Wi-Fi that blocks NTP would then kill ingestion on stage. Upgrade path is
`configTime()` + `setCACert()`.

---

## Deploy

```sh
./deploy.sh api      # backend box
./deploy.sh web      # frontend box
./deploy.sh          # both
```

Each runs `git pull --ff-only && docker compose -f compose.<role>.yaml up -d --build` over SSH, then
health-checks. Source is **bind-mounted**, so a Python change is a ~1 s `uvicorn --reload`, and a frontend
change is live the instant the pull lands — the image only rebuilds when `requirements.txt` changes.

Requires `~/.ssh/config` entries `saplink-api` and `saplink-web`, and `$SAPLINK_DOMAIN` exported locally.

### On the boxes

```sh
cd /opt/saplink
docker compose -f compose.api.yaml up -d --build    # or compose.web.yaml
docker compose -f compose.api.yaml logs -f caddy    # watch cert issuance
docker compose -f compose.api.yaml logs -f api      # backend logs
```

`/opt/saplink/.env`, gitignored, written by hand at provisioning time:

- **api box:** `SAPLINK_API_DOMAIN`, `SAPLINK_TOKEN`, `SAPLINK_WEB_ORIGIN`
- **web box:** `SAPLINK_WEB_DOMAIN`

### Gotchas

- **`caddy-data` must stay a named volume.** It holds the issued cert and ACME account. Drop it and you
  re-issue on every restart, which trips Let's Encrypt's 5-per-week duplicate-cert limit mid-hackathon.
- **Port 80 must stay open** even though everything redirects to HTTPS — Let's Encrypt's HTTP-01
  challenge uses it.
- **Cert won't issue before DNS resolves**, and a failed issuance backs off. Check `dig +short api.<domain>`
  first, not the Caddy logs.

---

## Checklist

- [x] `app/backend/main.py` — routes at `/ingest` `/samples` `/events` `/health`, CORS from `SAPLINK_WEB_ORIGIN`
- [x] `app/backend/test_ingest.py` passes: `.venv/bin/python app/backend/test_ingest.py`
- [x] `Caddyfile.api` / `Caddyfile.web`, `compose.api.yaml` / `compose.web.yaml`, `deploy.sh`
- [x] `app/frontend/config.js` exposes `window.SAPLINK_API`
- [ ] Two Vultr instances provisioned (Ubuntu 24.04, 1 vCPU / 1 GB, Dallas)
- [ ] DNS: `api` → API IP, `@` and `www` → web IP; both resolve
- [ ] Docker + ufw (22/80/443) on both boxes; repo cloned to `/opt/saplink`; `.env` written
- [ ] Point `config.js` and `secrets.h` at the real domain
- [ ] `https://<domain>` and `https://api.<domain>/health` both green, valid certs
- [ ] `curl` POST to `/ingest` round-trips through `/samples`; bad token → 401
- [x] Firmware: `src/sensor_main.cpp` written, `src/diagnostic_main.cpp` preserved verbatim
- [ ] `include/secrets.h` filled in from the example
- [ ] ESP32 flashed (`pio run -e sensor -t upload`) → monitor shows `wifi ok` + `POST 200`
- [ ] `./deploy.sh` ships a change end to end

## Out of scope — for teammates

- **Frontend content** — write `app/frontend/index.html`; it goes live on the next `./deploy.sh web`.
  Integration is one call: poll `${window.SAPLINK_API}/samples?since_id=<last_id>`. No WebSocket/SSE
  until polling visibly isn't enough.
- **ESP-NOW A→B relay, relay/pump/LED** — not touched. When a second board arrives: ESP-NOW and Wi-Fi STA
  share one radio, so pin the ESP-NOW peer to the channel the STA is already on or the uploader drops
  offline.
- **Electrodes, real reads, spike thresholds** — see [The seam](#the-seam).
