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

app.get('/api/weather', (req, res) => {
  const t = Date.now() / 1000;
  res.json({
    location: 'Blacksburg, VA',
    temperature_f: Number((67 + Math.sin(t / 120) * 4).toFixed(1)),
    fetched_ts: t,
    ok: true
  });
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

// Fixture news, shaped like the real backend's /api/news (app/backend/news.py
// actually fetches these from real RSS feeds; this simulator has no feed to
// poll, so it's fixed copy instead) -- minutesAgo is turned into a
// published_ts at request time so "X min ago" on the front end still reads
// correctly no matter how long this dev server has been running.
const NEWS_TEMPLATES = [
  { source: 'Mongabay', title: 'Restored mangrove belts are cutting storm damage on the Sundarbans coast', link: 'https://news.mongabay.com/', summary: 'A five-year replanting effort has doubled canopy cover in the hardest-hit delta zones.', minutesAgo: 12 },
  { source: 'The Guardian', title: 'Old-growth "mother trees" found to share far more carbon than previously measured', link: 'https://www.theguardian.com/environment', summary: 'New isotope tracing shows hub trees routing resources to seedlings even during drought stress.', minutesAgo: 47 },
  { source: 'Yale E360', title: 'Reforestation projects are starting to track fungal network health, not just tree count', link: 'https://e360.yale.edu/', summary: 'Ecologists argue canopy cover alone hides whether a replanted stand can actually support itself.', minutesAgo: 95 },
  { source: 'Grist', title: 'Cities are wiring sidewalk trees with low-cost sensors to catch drought stress early', link: 'https://grist.org/', summary: 'Early pilots report catching water stress up to two weeks before visible leaf damage.', minutesAgo: 160 },
  { source: 'ScienceDaily', title: 'Seedlings planted near surviving "hub" trees show measurably higher survival rates', link: 'https://www.sciencedaily.com/', summary: 'The effect holds even when the hub tree itself is showing signs of stress.', minutesAgo: 240 },
  { source: 'Mongabay', title: 'Selective logging near old-growth hubs disrupts underground signaling for years', link: 'https://news.mongabay.com/', summary: 'Even light-touch harvesting nearby measurably changes stress-response timing in neighboring plants.', minutesAgo: 320 }
];

app.get('/api/news', (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
  const now = Math.floor(Date.now() / 1000);
  const items = NEWS_TEMPLATES.slice(0, limit).map((n, i) => ({
    id: i + 1, source: n.source, title: n.title, link: n.link, summary: n.summary,
    published_ts: now - n.minutesAgo * 60
  }));
  res.json({ items });
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
