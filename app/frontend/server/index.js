import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const DEVICES = ['sense-1', 'sense-2', 'sense-3', 'sense-4', 'sense-5'];
const BASELINE = 42;
const THRESHOLD = 70;

// In-memory reading store, shaped exactly like app/backend/main.py's real
// response so the front end needs zero code changes between this simulator
// and the real API -- only VITE_API_BASE_URL differs between the two.
const readings = [];
let nextId = 1;
let seq = 900;
let batches = 0;
let lastRecv = null;
const alerts = [];

function sample() {
  const i = nextId;
  const spiking = i % 47 === 0;
  const mv = spiking
    ? 82 + Math.random() * 14
    : BASELINE + Math.sin(i / 7) * 3.4 + (Math.random() - 0.5) * 2.2;
  seq += Math.random() < 0.04 ? 2 : 1; // occasional dropped batch
  const row = {
    batch_id: nextId++, device: 'sense-1', seq, t_ms: Date.now(),
    mv: Number(mv.toFixed(2)), baseline_mv: BASELINE, src: 'sim',
    event: spiking ? 'spike' : null, soil_mv: null
  };
  readings.push(row);
  if (readings.length > 5000) readings.splice(0, readings.length - 5000);
  batches++;
  lastRecv = Date.now() / 1000; // real API's last_recv is a Unix seconds float
  if (spiking) alerts.push({ id: alerts.length + 1, kind: 'VP_SPIKE', voltage_mv: row.mv, threshold_mv: THRESHOLD, timestamp_ms: row.t_ms, acked: false });
}
for (let i = 0; i < 120; i++) sample();
setInterval(sample, 1000);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, batches, last_recv: lastRecv, devices: DEVICES });
});

app.get('/api/readings/latest', (req, res) => {
  const latest = readings[readings.length - 1] || null;
  res.json({ last_id: latest ? latest.batch_id : 0, sample: latest });
});

app.get('/api/readings/history', (req, res) => {
  const since = Number(req.query.since_id || 0);
  const samples = readings.filter((r) => r.batch_id > since).slice(-500);
  const lastId = samples.length ? samples[samples.length - 1].batch_id : since;
  res.json({ last_id: lastId, samples });
});

app.get('/api/alerts', (req, res) => res.json({ alerts: alerts.slice(-50) }));

app.post('/api/alerts/manual', (req, res) => {
  const alert = { id: alerts.length + 1, kind: 'REPLAY_TRIGGER', timestamp_ms: Date.now(), acked: true };
  alerts.push(alert);
  res.status(201).json({ alert });
});

app.post('/api/alerts/:id/ack', (req, res) => {
  const a = alerts.find((x) => String(x.id) === req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  a.acked = true;
  res.json({ alert: a });
});

// Optional local smoke test of a production build against this fake API --
// `npm run build && npm start`. Not the real deployment path: production is
// static dist/ served by Caddy against the real backend, see README.md.
app.use(express.static(path.join(__dirname, '..', 'dist')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'), (err) => err && next());
});

app.listen(PORT, () => console.log('Saplink API on http://localhost:' + PORT));
