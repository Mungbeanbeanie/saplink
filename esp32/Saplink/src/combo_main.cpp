#include <Adafruit_ADS1X15.h>
#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>

#include "cloud_client.h"
#include "peak_detector.h"
#include "recorded_signal.h"
#include "secrets.h"
#include "signal_conditioning.h"

// Both plants' probes: stem electrode and soil reference on one differential
// pair each. The ADS1115 offers only A0-A1 and A2-A3 as differential pairs, so
// two plants is exactly what this chip holds -- the pairing is fixed by the
// wiring rather than chosen, and there is no third.
#define SDA_PIN 21
#define SCL_PIN 22

// PLANT 2's pump. Plant 2 is now sensed as well as watered, so unlike before
// there IS a path from the pump back to an electrode -- but not a live one:
// actuate() blocks for the whole 1.5s run, so no samples are taken while the
// motor is on, and the trace carries a gap rather than the motor's EMI.
// Polarity measured on the bench, not read off the silkscreen -- see
// pump_main.cpp, which pulsed the pin both ways and let the motor answer.
static const uint8_t RELAY_PIN = 26;
static const int RELAY_ON = HIGH;
static const int RELAY_OFF = LOW;
static const uint32_t kPumpRunMs = 1500;

// Calibration knob, not a runaway guard: there is no feedback path. A noisy
// electrode firing on consecutive batches simply must not empty the reservoir
// halfway through a demo.
static const uint32_t kMinActuateGapMs = 30000;

// The polled floor under ingestion: one batch goes up per interval whatever the
// plant is doing, so the dashboard always has a baseline trace (and
// /api/health's last_recv, which its connection panel reads, stays fresh).
// Event windows ride ON TOP of this at full resolution -- see loop(). Batches
// are still sampled continuously at ~3.2s each; this only decides how many are
// uploaded, so at 10000 roughly every third one is. Calibration knob: raise it
// if uploads cost too much, 0 reverts to event-only and leaves the chart empty
// between events.
// LOWERED to 2000: measured missed-batch rate at 10000 was ~65-84% of quiet-
// stretch samples (seq gaps of ~3 between uploaded batches). A full loop
// (sample + POST + poll-pending + ack) takes ~3.7-4.6s measured, so 2000 sits
// under that floor -- poll_due is now true every loop, not every ~3rd, so
// (almost) every sampled batch uploads. Total POST volume/hour lands roughly
// where a queue-and-burst-at-10000 design would have too; this is just the
// simpler way to get there, no new buffering state needed.
static const uint32_t kPollMs = 2000;

static Adafruit_ADS1115 ads;
static bool ads_ok = false;
static CloudClient cloud;

// 10 Hz into a 32-sample buffer -> one batch every ~3.2s. Whether that batch is
// uploaded is a separate question now; see loop().
static const uint32_t PERIOD_MS = 100;
static const size_t BATCH_N = 32;

// "sim" until an ADC is actually wired. The backend records this, so on stage
// you can always tell a live trace from a synthetic one.
//
// GLOBAL, and that is a known hole now that two plants share the chip: ads_ok
// only proves the ADS1115 answered on I2C, not that either differential pair
// has a live electrode on it. If A0-A1 came loose while A2-A3 stayed good,
// plant 2 would post src:"ads1115" over a garbage trace and the guarantee
// above quietly fails for one plant. env:soil is the per-pair liveness test --
// run it, rather than building a second one in here.
static const char *SRC = "sim";

// SHARED, not per-plant: seq is the batch CYCLE, so plant 1's seq=N and plant
// 2's seq=N cover the same ~3.2s window and the two device streams line up by
// seq alone. Gap detection still works per device because both increment in
// lockstep -- the dashboard filters by device and sees a contiguous run.
static uint32_t seq = 0;

static uint32_t last_actuate_ms = 0;
static uint32_t last_upload_ms = 0;

// One batch's worth of everything post() ships. Grouped into a struct so
// holding a batch back is ONE assignment (p.prev = p.cur) instead of six
// field-by-field copies per plant: every field here is captured WITH the
// batch, not read at send time, because the pre-trigger batch is uploaded one
// cycle late and reporting the CURRENT baseline/soil against older samples
// would quietly misdate both. With two plants that copy would have happened
// twice, and forgetting one field on one plant is silent -- it produces
// plausible-looking numbers, not an error.
struct Snapshot {
  uint32_t t_ms = 0;
  // The conditioner's adaptive baseline -- the electrode's true standing
  // potential -- not the mean of the batch. The batch mean was a fair stand-in
  // while mv[] carried absolute readings, but mv[] now carries drift-removed
  // deviations whose mean is ~0 by construction, which would have reported a
  // live 30mV electrode as sitting at zero.
  float baseline_mv = 0.0f;
  uint32_t soil_mv = 0;
  // The 6s waveform spans ~2 batches, so a held-back batch can carry injected
  // samples too -- it must not be labelled as clean.
  bool replayed = false;
  float mv[BATCH_N] = {0};      // cond.deviation(), what the frontend plots
  float raw_mv[BATCH_N] = {0};  // what the ADC produced, pre-conditioning
};

// Everything that is per-plant. Two instances and one loop over them: the
// alternative was a `2` suffix on twelve globals plus a duplicated call site
// for each, in this file's two most intricate regions (the deadline-scheduled
// sample loop and the spike/tail/poll state machine). That is where a
// two-plant rig silently becomes a one-plant rig with a copy-paste bug.
struct Plant {
  // --- wiring. Fixed by what is soldered where, not chosen. ---
  // Contract A's device field. The ENTIRE multi-plant story rides on this one
  // string: same schema, same table, two streams, no migration. The board
  // posts one batch per plant per cycle and the backend already keys on it.
  const char *device;
  // ORIGIN, on BOTH contracts: the alert's "who raised it, not who acts", and
  // the batch's "which electrode pair produced this waveform". One number in
  // both so an alert and the batch that triggered it name the same node. This
  // -- not device -- is what the backend's site map counts as a router; the
  // soil probe below is data about this node, never a node of its own.
  uint8_t node_id;
  // The ADS1115 offers only A0-A1 and A2-A3 as differential pairs, so a bool
  // covers the entire space and there is nothing to generalise. false = A2-A3,
  // the pair probe_main.cpp characterised.
  bool ads_pair_0_1;
  // Soil moisture AOUT. ADC1 only -- the ADC2 pins (GPIO0/2/4/12-15/25-27)
  // stop converting the moment WiFi starts, and this sketch runs WiFi.
  uint8_t soil_pin;

  // --- pipeline state, one full copy each ---
  SignalConditioner cond;
  PeakDetector det;
  // Per-plant, but only the ~12-byte playback cursor is duplicated: the
  // waveform itself is one shared const array.
  RecordedSignalPlayer player;

  Snapshot cur, prev;
  bool prev_valid = false;  // false on the very first loop, nothing to send
  bool prev_sent = false;   // don't send the same batch twice

  bool send_tail = false;   // survives one cycle by design: the batch after a
                            // spike carries the VP tail
  // Reset at the top of every cycle, never read across one.
  bool spike = false;
  bool sent = false;
  float peak_mv = 0.0f;
  float threshold_mv = 0.0f;
  uint32_t spike_ms = 0;

  // A constructor rather than brace-init of the four wiring fields: the core
  // builds at -std=gnu++11, where the default member initializers above make
  // this a non-aggregate, so `Plant p = {...}` does not compile.
  Plant(const char *d, uint8_t n, bool pair_0_1, uint8_t soil)
      : device(d), node_id(n), ads_pair_0_1(pair_0_1), soil_pin(soil) {}
};

// Plant 1's A2-A3 pair and GPIO34 probe are UNCHANGED -- that is the pair
// probe_main.cpp characterised, and every measured constant in this file
// (GAIN_FOUR's headroom, kSigmaFloorMv, kMinAmplitudeMv) was tuned against it.
// Plant 2 mirrors it onto the chip's only other differential pair and onto
// GPIO35, both of which soil_main.cpp already surveyed.
//
// Plant 2's identity is hardcoded HERE rather than added to secrets.h on
// purpose: the two plants are one board's two channels, so "which stream is
// which" is wiring, not a secret, and a gitignored file is the wrong place for
// something a reader needs in order to make sense of the batch table. Plant 1
// keeps its #defines so an existing secrets.h and every row already in the DB
// go on meaning exactly what they meant.
//
// Unsized on purpose: every loop below is a range-for, so commenting out the
// second line is a complete, one-line revert to single-plant behaviour.
static Plant plants[] = {
    Plant(DEVICE_ID, NODE_ID, /*ads_pair_0_1=*/false, 34),
    Plant("sense-2", 2, /*ads_pair_0_1=*/true, 35),
};

// One mains period. Averaging ADC reads across exactly this long integrates
// 60Hz hum to zero -- a boxcar's first null sits at 1/span. Calibration knob:
// 20000 in a 50Hz country.
//
// This is NOT the 60Hz notch that was correctly dropped from Phase 2. A notch
// is a post-sampling filter and there is nothing left to notch: at a ~10Hz
// sample rate, 60Hz has already folded down to ~3Hz, in-band and mathematically
// indistinguishable from a real signal (measured: lag-3 autocorrelation
// 0.64-0.97 on every quiet batch, 1-4mV peak-to-peak, which the 5-sample median
// does not touch). Aliasing is irreversible, so the hum has to die before the
// sample exists -- which means during the conversion, not after it.
static const uint32_t kMainsAvgUs = 16667;

// Calibration knob, currently 0: discard the first N conversions of each
// averaging window. At GAIN_FOUR the ADS1115's differential input impedance is
// low enough that its switched-capacitor input can carry charge between pairs,
// and with two plants the mux now alternates -- though only the FIRST read of
// each window sees a pair change, the remaining ~5 being same-pair.
// Symptom if it matters: both plants' baselines pulled toward each other by a
// FIXED offset, worse the higher the electrode impedance, and steady rather
// than noisy. Set to 1 and re-measure; it costs ~3ms of the slot's ~60ms of
// slack. Bench check: jumper A2 to A3 and see whether the shorted pair reads
// ~0 or a fraction of the live pair (soil_main.cpp's d01/d23 print).
static const uint32_t kDiscardFirstReads = 0;

// THE SEAM, now crossed: the ADS1115 is wired and both differential pairs are
// read for real. The synthetic trace stays as the fallback so a loose wire
// degrades the demo to a realistic shape rather than a flat line, and SRC
// records which one produced the batch -- on stage a live trace must never be
// mistaken for a simulated one.
static float readMv(const Plant &p, uint32_t n) {
  if (ads_ok) {
    // Time-boxed rather than a fixed read count: at 50kHz the library busy-polls
    // the conversion-ready bit over I2C, so per-read time is not deterministic
    // and counting conversions cannot reliably land on a whole mains cycle.
    // micros() can. The do/while overshoots by at most one read, which across
    // plausible per-read times leaves the sample centres spanning 0.90-0.96 of a
    // cycle -- 19 to 27dB of rejection, turning 2mV of hum into under 0.25mV.
    //
    // This budget is PER PLANT, so a two-plant slot spends ~34-40ms of its
    // 100ms converting. The rejection maths is unchanged: each pair still gets
    // its own full window and its own ~6 averaged conversions.
    const uint32_t t0 = micros();
    float sum = 0.0f;
    uint32_t n_reads = 0, discarded = 0;
    do {
      // A ternary, not a stored mux register: both of these are single-shot
      // library calls that rewrite the WHOLE config register -- mux field
      // included -- on every conversion, so alternating pairs between readMv()
      // calls costs no settling time the single-channel path was not already
      // paying. The "first conversion after a mux change is garbage" hazard is
      // a continuous-mode problem; this code never leaves single-shot.
      // Upgrade path if a third pair ever exists: store a mux constant and
      // drive startADCReading()/conversionComplete() directly.
      const int16_t counts = p.ads_pair_0_1 ? ads.readADC_Differential_0_1()
                                            : ads.readADC_Differential_2_3();
      if (discarded < kDiscardFirstReads) {
        discarded++;
        continue;
      }
      sum += ads.computeVolts(counts) * 1000.0f;
      n_reads++;
    } while (micros() - t0 < kMainsAvgUs);
    // Averaging also divides the per-conversion noise by sqrt(n_reads), which
    // is what pays for running the ADC at 860SPS instead of the quieter default.
    // n_reads can only be 0 if kDiscardFirstReads ate the whole window.
    if (n_reads == 0) return 0.0f;
    return sum / n_reads;
  }
  // Per-plant phase offset, and it is not cosmetic: without it both plants
  // draw the identical synthetic curve and fire their (n % 200) spikes on the
  // same sample, so both detectors trip together, both post alerts, and the
  // backend's one-un-acked-at-a-time dedupe silently swallows one of them.
  // The offset is arbitrary -- only being non-zero and unequal matters.
  n += p.node_id * 523;
  float wander = 3.0f * sinf(n * 0.004f);
  float spike = (n % 200) < 8 ? 45.0f : 0.0f;
  float noise = 0.4f * (random(-100, 101) / 100.0f);
  return wander + spike + noise;
}

// Raw mV, deliberately not a percentage, for BOTH plants. Converting to
// "% moisture" takes a two-point calibration of each specific probe in dry and
// in saturated soil. soil_main.cpp now has those endpoints measured per sensor
// (kDryMv/kWetMv, by air/water dip) -- but mapping here would put a percentage
// on the dashboard while the electrode trace beside it stays raw mV, and the
// two plants stay directly comparable only while both are raw. Map both at
// once, or neither. Averaged because ESP32 ADC1 jitters tens of mV per read.
static uint32_t readSoilMv(uint8_t pin) {
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) sum += analogReadMilliVolts(pin);
  return sum / 16;
}

static bool wifiUp() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("wifi: connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) delay(250);
  if (WiFi.status() != WL_CONNECTED) {
    // Don't block forever -- a board that can't find the network should say so
    // and keep retrying, not sit silent.
    Serial.printf("wifi: FAILED (status=%d), retrying\n", WiFi.status());
    return false;
  }
  Serial.print("wifi ok ");
  Serial.println(WiFi.localIP());
  return true;
}

// One plant's batch. batch_seq is a parameter rather than the global, which is
// what lets the held-back pre-trigger batch keep its own sequence number --
// the caller used to decrement the global around the call and put it back.
//
// ONE PLANT PER CALL, deliberately: two plants means two batches on the wire
// distinguished by p.device, not one batch carrying a second waveform. Two
// 32-float arrays already run ~820 bytes worst case, and body[] below is a
// STACK allocation on a task that also builds a WiFiClientSecure -- doubling
// it to hold a second pair of arrays is how you get an intermittent
// stack-overflow reboot that never reproduces on the bench.
static void post(const Plant &p, uint32_t batch_seq, const Snapshot &s,
                 bool spike) {
  // One fixed-shape object; snprintf beats pulling in a JSON library for it.
  // 2048, not 1024: two 32-float arrays plus the header run ~820 bytes worst
  // case. It would fit, but with no margin, and the guard below drops the whole
  // batch rather than truncating -- an overflow costs the event, not a field.
  char body[2048];
  // node_id ships alongside device on purpose: device is the free-text stream
  // label the dashboard filters its chart by, node_id is WHICH ELECTRODE PAIR
  // this waveform came out of. The backend's site map counts nodes off the
  // latter, so a batch without it is data and not a router -- which is what
  // keeps hand-rolled curl posts from drawing hardware that isn't there.
  int n = snprintf(body, sizeof body,
                   "{\"device\":\"%s\",\"node_id\":%u,\"seq\":%lu,\"t_ms\":%lu,"
                   "\"period_ms\":%lu,"
                   "\"baseline_mv\":%.3f,\"event\":%s,\"src\":\"%s\","
                   "\"soil_mv\":%lu,\"replay\":%s,\"mv\":[",
                   p.device, (unsigned)p.node_id, (unsigned long)batch_seq,
                   (unsigned long)s.t_ms,
                   (unsigned long)PERIOD_MS, s.baseline_mv,
                   spike ? "\"spike\"" : "null", SRC,
                   (unsigned long)s.soil_mv, s.replayed ? "true" : "false");
  for (size_t i = 0; i < BATCH_N && n > 0 && n < (int)sizeof body; i++)
    n += snprintf(body + n, sizeof body - n, i ? ",%.3f" : "%.3f", s.mv[i]);
  // raw_mv is what the ADC produced, before conditioning. mv[] above carries
  // deviations, and baseline + deviation reconstructs the MEDIAN-FILTERED value
  // rather than the raw one -- so without this the raw read is simply gone.
  n += snprintf(body + n, sizeof body - n, "],\"raw_mv\":[");
  for (size_t i = 0; i < BATCH_N && n > 0 && n < (int)sizeof body; i++)
    n += snprintf(body + n, sizeof body - n, i ? ",%.3f" : "%.3f", s.raw_mv[i]);
  if (n < 0 || n + 3 > (int)sizeof body) {
    Serial.println("post: payload overflow, dropped batch");
    return;
  }
  snprintf(body + n, sizeof body - n, "]}");

  WiFiClientSecure client;
  // ponytail: setInsecure() skips cert validation. The bearer token is the real
  // auth and TLS still stops passive sniffing. Proper pinning needs an
  // NTP-synced clock plus ISRG Root X1, and a captive-portal Wi-Fi that blocks
  // NTP would then kill ingestion on stage. Upgrade: configTime() + setCACert().
  client.setInsecure();

  HTTPClient http;
  if (!http.begin(client, SAPLINK_URL)) {
    Serial.println("post: begin failed");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " SAPLINK_TOKEN);
  int code = http.POST((uint8_t *)body, strlen(body));
  Serial.printf("POST %d %s seq=%lu\n", code, p.device,
                (unsigned long)batch_seq);
  if (code < 0) Serial.printf("  %s\n", http.errorToString(code).c_str());
  else if (code >= 400) Serial.printf("  %s\n", http.getString().c_str());
  http.end();
}

// Log BEFORE energising, never during. The motor's EMI makes serial unreadable
// while it runs -- pump_main.cpp measured 84-440KB of framing garbage per run
// against 260 clean bytes idle. Blocking is deliberate too: readings taken
// during the run would be that same EMI, so a 1.5s gap in the trace is more
// honest than 1.5s of noise pretending to be a signal. That now matters twice
// over -- plant 2 is both the plant being watered and a sensed one, so it is
// its own electrode the motor would be shouting into.
static void actuate(const char *why) {
  Serial.printf("pump ON  (%s) t=%lu\n", why, (unsigned long)millis());
  digitalWrite(RELAY_PIN, RELAY_ON);
  // Read the pin back. On ESP32 digitalRead() on an OUTPUT returns the level
  // actually being driven, so this separates "firmware never got here / the
  // write did not take" from "the pin went high and the relay ignored it" --
  // which is the difference between a code bug and a wiring or supply one.
  // Printed immediately, before the motor's EMI makes serial unreadable.
  Serial.printf("  gpio%u=%d (expect %d)\n", RELAY_PIN, digitalRead(RELAY_PIN),
                RELAY_ON);
  delay(kPumpRunMs);
  digitalWrite(RELAY_PIN, RELAY_OFF);
  last_actuate_ms = millis();
  Serial.printf("pump OFF t=%lu\n", (unsigned long)last_actuate_ms);
}

void setup() {
  // FIRST, before anything slow. At reset GPIO26 floats, and a floating IN on
  // an active-high module is undefined -- relayoff_main.cpp measured 1482mv,
  // which is above logic-low. Safe means DRIVEN off, not untouched.
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);

  Serial.begin(115200);
  delay(300);
  Serial.println("\nsaplink combo node: plants 1+2 sense, plant 2 gets watered");
  Serial.println("keys: r/t = inject recorded VP into plant 1/2, p = test pump");

  // 50kHz, not 100k: the electrode leads run alongside the bus and 100kHz threw
  // enough timeouts to lose samples. Nothing here needs the bandwidth.
  Wire.begin(SDA_PIN, SCL_PIN, 50000);
  ads_ok = ads.begin(0x48);
  // +-1.024V at 31uV/bit. The stem-vs-soil pair measures ~30mV, so this leaves
  // ~30x headroom while still resolving the sub-mV noise floor that the 3-sigma
  // threshold is computed from. One gain for both pairs: the ADS1115 has a
  // single PGA, so this is a chip-wide setting, not a per-plant one.
  ads.setGain(GAIN_FOUR);
  // 860SPS, not the 128SPS default. readMv() averages across one mains period,
  // and at 128SPS a conversion costs ~8ms -- only two of them fit in 16.667ms,
  // which spans barely half a cycle and rejects almost nothing. At 860SPS a read
  // costs ~3ms, so ~6 land in the window. The per-conversion noise is higher at
  // this rate; the sqrt(6) from averaging gives it back.
  ads.setDataRate(RATE_ADS1115_860SPS);
  SRC = ads_ok ? "ads1115" : "sim";
  Serial.printf("ads1115 @0x48: %s -> src=%s\n", ads_ok ? "ok" : "ABSENT", SRC);

  // 11dB = full 0-3.3V span; the core defaults to 0-1.1V on some versions,
  // which silently pins a real sensor reading at the top of the range. A loop
  // rather than one call per pin: missing a plant here produces a hard ceiling
  // with no error anywhere, and the loop cannot be half-done.
  for (const Plant &p : plants) analogSetPinAttenuation(p.soil_pin, ADC_11db);

  wifiUp();
}

void loop() {
  // Once per batch, not per sample: a keypress that lands mid-batch waits at
  // most 3.2s, and polling Serial 32 times a batch buys nothing.
  if (Serial.available()) {
    const int key = Serial.read();
    // Separate keys, not one that fires both. The claim being demonstrated is
    // that these are two INDEPENDENT streams, and injecting into both on the
    // same sample cannot show that -- it produces exactly the simultaneous,
    // identical deflection that a sceptic would call a common-mode artifact,
    // which is the objection the differential wiring exists to preempt.
    // 'r' stays plant 1 so existing notes and muscle memory stay true.
    if (key == 'r') {
      Serial.println("replay: armed (plant 1)");
      plants[0].player.trigger();
    } else if (key == 't') {
      Serial.println("replay: armed (plant 2)");
      plants[1].player.trigger();
    } else if (key == 'p') {
      // Bench test only -- primes the line and proves the relay before a demo.
      // Deliberately NOT a stimulus path: actuate() blocks for the whole run,
      // so nothing is sampled while the motor is on.
      actuate("manual test");
    }
  }

  const uint32_t t_ms = millis();
  for (Plant &p : plants) {
    p.spike = false;
    p.sent = false;
    p.cur.replayed = false;
    // Both plants share the batch start time. Plant 2's samples are really
    // taken ~17ms after plant 1's, which is 0.17 of one sample period against
    // VPs that last tens of seconds -- recording two different t_ms values
    // would imply a precision the 10Hz grid does not have.
    p.cur.t_ms = t_ms;
  }

  // Deadline, not a fixed post-read delay. readMv() costs ~17ms per plant, so
  // ~34ms of a two-plant slot, and delay(PERIOD_MS) would make the true sample
  // period ~134ms while Contract A keeps claiming 100 -- and the dashboard
  // timestamps every sample as t_ms + i*period_ms, so that gap compounds
  // across a batch. PeakDetector's hold gate is counted in samples too, which
  // only means a duration if the period is what it says it is. next_ms is
  // absolute, so adding the second plant shortens the wait below rather than
  // moving the period it enforces.
  uint32_t next_ms = t_ms;

  for (size_t i = 0; i < BATCH_N; i++) {
    // Both plants inside one slot, before the deadline wait -- so they share a
    // sample grid rather than drifting apart by however long a read takes.
    for (Plant &p : plants) {
      float raw = readMv(p, seq * BATCH_N + i);
      float injected;
      // SUPERIMPOSED, not substituted. The waveform is 0-centred; replacing the
      // read would step the baseline by the electrode's whole standing offset and
      // read as an artifact rather than a VP. Riding the live baseline is what a
      // real deflection does.
      if (p.player.nextSample(injected)) {
        raw += injected;
        p.cur.replayed = true;
      }
      // Captured BEFORE conditioning and before nothing else -- this is the only
      // record of what the ADC actually saw. On a replay batch it stays
      // pre-injection, so raw_mv and mv differ by exactly the injected waveform
      // and the replay flag explains why.
      p.cur.raw_mv[i] = raw;
      p.cond.update(raw);
      // Deviation, not the raw reading. The frontend gets a trace centred on zero
      // with the electrode's polarization drift already subtracted out -- raw mV
      // wanders tens of millivolts over minutes and cannot be drawn on a fixed
      // axis. baseline_mv carries the absolute value for anyone who wants it.
      p.cur.mv[i] = p.cond.deviation();
      // Sigma is measured, not assumed: on a settled electrode it sits near the
      // 0.031mV floor, so a real deflection clears 3-sigma by a wide margin.
      // Gated on warm() -- before sigma has converged the threshold is far too
      // low and every batch reports a spike, which is exactly what hardware did.
      // Both plants warm independently, and in parallel: ~100 samples each.
      if (p.cond.warm() && p.det.check(p.cond.deviation(), p.cond.sigma())) {
        p.spike = true;
        p.spike_ms = millis();
        // Taken from the detector, NOT scanned out of this batch. A deflection is
        // tracked across batches, so its peak often lives in the previous one --
        // scanning locally reported 4.128mV against a 4.964mV threshold on
        // hardware, a voltage that had supposedly cleared a higher bar.
        p.peak_mv = p.det.lastPeak();
        p.threshold_mv = p.det.lastThreshold();
      }
    }
    // Signed comparison: if a sample overran its slot the wait is negative and
    // this must fall through immediately, not wrap to a 49-day delay.
    next_ms += PERIOD_MS;
    int32_t wait_ms = (int32_t)(next_ms - millis());
    if (wait_ms > 0) delay((uint32_t)wait_ms);
  }
  // Once per batch, not per slot: 16 averaged ADC1 reads per plant costs a few
  // ms total and sits outside the mains-averaged window above.
  for (Plant &p : plants) p.cur.soil_mv = readSoilMv(p.soil_pin);

  // Sample first, network second. Conditioning no longer sits behind wifiUp():
  // a dropped connection used to stop the pipeline dead, so a demo that lost
  // Wi-Fi lost its signal too, and this path could not be checked at all
  // without working credentials. The batch is conditioned and printed either
  // way, and these lines are exactly what the frontend would have received.
  for (Plant &p : plants) {
    p.cur.baseline_mv = p.cond.baseline();
    Serial.printf(
        "seq=%lu %s src=%s baseline=%.3fmv sigma=%.3fmv soil=%lumv %s%s\n",
        (unsigned long)seq, p.device, SRC, p.cond.baseline(), p.cond.sigma(),
        (unsigned long)p.cur.soil_mv, p.spike ? "SPIKE" : "",
        p.cur.replayed ? " [replay]" : "");
  }

  // Ingestion is polled at kPollMs, event-driven on top. Polling keeps a
  // baseline trace flowing while the plant is quiet; an event still sends the
  // whole window AROUND it -- the batch before (the onset, already past by the
  // time the detector confirms a rebound), the batch it fired in, and the one
  // after (the tail) -- so an event is ~9.6s of CONTIGUOUS waveform at the full
  // sample rate, where a polled stretch is one batch per interval.
  const bool poll_due = kPollMs && (millis() - last_upload_ms >= kPollMs);
  bool any_sent = false;

  if (wifiUp()) {
    for (Plant &p : plants) {
      if (p.spike) {
        // The held-back batch keeps its own sequence number. seq-1 cannot
        // underflow: prev_valid is false on the only cycle where seq is 0.
        if (p.prev_valid && !p.prev_sent) post(p, seq - 1, p.prev, false);
        post(p, seq, p.cur, true);
        p.sent = true;

        // Contract B. event_type distinguishes an injected VP from a real one --
        // src stays "ads1115" either way because the ADC genuinely is live, so
        // without this the dashboard cannot tell them apart.
        PacketSchema pkt;
        // The ORIGIN, per plant. This is the one field that makes plant 2's
        // events distinguishable from plant 1's once both are in the alert
        // table -- nothing else on Contract B carries which electrode fired.
        pkt.node_id = p.node_id;
        pkt.event_type =
            p.cur.replayed ? EventType::REPLAY_TRIGGER : EventType::VP_SPIKE;
        // Magnitude, not the signed value. A VP deflects negative, and the
        // threshold is a positive bar, so shipping the sign here would make
        // voltage_mv < threshold_mv on the wire and read as "did not clear" all
        // over again. Nothing is lost: the signed waveform is in the readings
        // batch posted alongside this, sample by sample.
        pkt.voltage_mv = fabsf(p.peak_mv);
        pkt.threshold_mv = p.threshold_mv;
        pkt.timestamp_ms = p.spike_ms;
        cloud.postAlert(pkt);

        p.send_tail = true;
      } else if (p.send_tail) {
        post(p, seq, p.cur, false);
        p.sent = true;
        p.send_tail = false;
      } else if (poll_due) {
        post(p, seq, p.cur, false);
        p.sent = true;
      }
      any_sent = any_sent || p.sent;
    }
    if (any_sent) last_upload_ms = millis();

    // Close the route. The board does NOT pump on its own detection -- it pumps
    // on an event the backend handed back, which is the whole point of routing
    // through the cloud instead of writing an if-statement here.
    //
    // ONCE per cycle, outside the per-plant loop: the pump is a single physical
    // device, so polling it per plant would ack two alerts per cycle and halve
    // the effective cooldown for no gain. Which plant raised the alert does not
    // change what happens here either -- there is one relay and it is in plant
    // 2 -- so there is deliberately no target filter. See the ponytail note on
    // /api/alerts/pending: the backend's one-un-acked-at-a-time rule plus
    // kMinActuateGapMs already cap this at one dose per 30s however many plants
    // are firing.
    int alert_id = 0;
    PacketSchema incoming;
    if (cloud.pollPendingAlert(incoming, alert_id)) {
      // Ack BEFORE actuating. A failed ack then costs a missed dose rather than
      // a repeated one, and the wrong direction on a pump is a flooded plant.
      if (cloud.ackAlert(alert_id)) {
        if (last_actuate_ms && millis() - last_actuate_ms < kMinActuateGapMs) {
          // Acked anyway: leaving it un-acked would make the backend's dedupe
          // keep handing back the same alert, wedging /api/alerts/pending on an
          // event nobody will ever act on.
          Serial.printf("cooldown, skipped id=%d node=%u\n", alert_id,
                        incoming.node_id);
        } else {
          actuate("alert");
        }
      }
    }
  }

  // OUTSIDE the wifiUp() block, deliberately. A dropped connection must leave
  // prev_sent false so the held-back pre-trigger batch survives to be sent
  // later; assigning this inside would leave it stale-true after a drop and
  // silently discard the onset of the next spike. That is also why `sent` is a
  // reset-every-cycle Plant field rather than a local.
  for (Plant &p : plants) {
    p.prev = p.cur;  // one assignment: see the Snapshot comment
    p.prev_valid = true;
    p.prev_sent = p.sent;
  }
  seq++;
}
