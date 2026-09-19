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

// Where the probes actually sit: stem electrode on A2, soil reference on A3.
// The ADS1115 offers only A0-A1 and A2-A3 as differential pairs, so this
// pairing is fixed by the wiring rather than chosen.
#define SDA_PIN 21
#define SCL_PIN 22

// Soil moisture AOUT. ADC1 only -- the ADC2 pins (GPIO0/2/4/12-15/25-27) stop
// converting the moment WiFi starts, and this sketch runs WiFi.
#define SOIL_PIN 34

// PLANT 2's pump, not plant 1's. The electrodes above read plant 1; this relay
// waters the neighbour. That separation is why there is no feedback loop to
// guard against -- watering plant 2 cannot move plant 1's electrode.
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

// Liveness ping while nothing is happening. Ingestion is event-driven, so a
// healthy board is silent -- and /api/health's last_recv, which the dashboard's
// connection panel reads, would go stale and report it as offline. Set to 0 for
// true silence and accept that panel going red.
static const uint32_t kHeartbeatMs = 60000;

static Adafruit_ADS1115 ads;
static bool ads_ok = false;

static SignalConditioner cond;
static PeakDetector det;
static CloudClient cloud;
static RecordedSignalPlayer player;

// 10 Hz into a 32-sample buffer -> one batch every ~3.2s. Whether that batch is
// uploaded is a separate question now; see loop().
static const uint32_t PERIOD_MS = 100;
static const size_t BATCH_N = 32;

// "sim" until an ADC is actually wired. The backend records this, so on stage
// you can always tell a live trace from a synthetic one.
static const char *SRC = "sim";

static float buf[BATCH_N];
static float raw_buf[BATCH_N];
static uint32_t seq = 0;

// One batch of pre-trigger context. A VP's onset is the interesting part and it
// has already happened by the time the detector confirms the rebound, so the
// batch BEFORE the spike is held back and sent with it.
static float prev_buf[BATCH_N];
static float prev_raw_buf[BATCH_N];
static uint32_t prev_t_ms = 0;
static bool prev_valid = false;   // false on the very first loop, nothing to send
static bool prev_sent = false;    // don't send the same batch twice
static bool prev_replayed = false;  // the 6s waveform spans ~2 batches, so the
                                    // held-back one can carry injected samples
                                    // too -- it must not be labelled as clean
// Captured with the batch, not read at send time: the pre-trigger batch is
// uploaded one cycle late, and reporting the CURRENT baseline/soil against
// older samples would quietly misdate both.
static float prev_baseline = 0.0f;
static uint32_t prev_soil_mv = 0;
static bool send_tail = false;    // the batch after a spike carries the VP tail

static uint32_t last_actuate_ms = 0;
static uint32_t last_upload_ms = 0;

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

// THE SEAM, now crossed: the ADS1115 is wired and A2-A3 is read for real. The
// synthetic trace stays as the fallback so a loose wire degrades the demo to a
// realistic shape rather than a flat line, and SRC records which one produced
// the batch -- on stage a live trace must never be mistaken for a simulated one.
static float readMv(uint32_t n) {
  if (ads_ok) {
    // Time-boxed rather than a fixed read count: at 50kHz the library busy-polls
    // the conversion-ready bit over I2C, so per-read time is not deterministic
    // and counting conversions cannot reliably land on a whole mains cycle.
    // micros() can. The do/while overshoots by at most one read, which across
    // plausible per-read times leaves the sample centres spanning 0.90-0.96 of a
    // cycle -- 19 to 27dB of rejection, turning 2mV of hum into under 0.25mV.
    const uint32_t t0 = micros();
    float sum = 0.0f;
    uint32_t n_reads = 0;
    do {
      sum += ads.computeVolts(ads.readADC_Differential_2_3()) * 1000.0f;
      n_reads++;
    } while (micros() - t0 < kMainsAvgUs);
    // Averaging also divides the per-conversion noise by sqrt(n_reads), which
    // is what pays for running the ADC at 860SPS instead of the quieter default.
    return sum / n_reads;
  }
  float wander = 3.0f * sinf(n * 0.004f);
  float spike = (n % 200) < 8 ? 45.0f : 0.0f;
  float noise = 0.4f * (random(-100, 101) / 100.0f);
  return wander + spike + noise;
}

// Raw mV, deliberately not a percentage. Converting to "% moisture" takes a
// two-point calibration of this specific probe in dry and in saturated soil,
// and inventing those endpoints would put a fabricated number on the dashboard
// that looks exactly as authoritative as a measured one. Map it here once the
// two readings exist. Averaged because ESP32 ADC1 jitters tens of mV per read.
static uint32_t readSoilMv() {
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) sum += analogReadMilliVolts(SOIL_PIN);
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

// baseline_mv is now the conditioner's adaptive baseline -- the electrode's
// true standing potential -- not the mean of the batch. The batch mean was a
// fair stand-in while mv[] carried absolute readings, but mv[] now carries
// drift-removed deviations whose mean is ~0 by construction, which would have
// reported a live 30mV electrode as sitting at zero.
static void post(uint32_t t_ms, float baseline_mv, bool spike, uint32_t soil_mv,
                 const float *mv, const float *raw, bool replay) {
  // One fixed-shape object; snprintf beats pulling in a JSON library for it.
  // 2048, not 1024: two 32-float arrays plus the header run ~820 bytes worst
  // case. It would fit, but with no margin, and the guard below drops the whole
  // batch rather than truncating -- an overflow costs the event, not a field.
  char body[2048];
  int n = snprintf(body, sizeof body,
                   "{\"device\":\"%s\",\"seq\":%lu,\"t_ms\":%lu,\"period_ms\":%lu,"
                   "\"baseline_mv\":%.3f,\"event\":%s,\"src\":\"%s\","
                   "\"soil_mv\":%lu,\"replay\":%s,\"mv\":[",
                   DEVICE_ID, (unsigned long)seq, (unsigned long)t_ms,
                   (unsigned long)PERIOD_MS, baseline_mv,
                   spike ? "\"spike\"" : "null", SRC,
                   (unsigned long)soil_mv, replay ? "true" : "false");
  for (size_t i = 0; i < BATCH_N && n > 0 && n < (int)sizeof body; i++)
    n += snprintf(body + n, sizeof body - n, i ? ",%.3f" : "%.3f", mv[i]);
  // raw_mv is what the ADC produced, before conditioning. mv[] above carries
  // deviations, and baseline + deviation reconstructs the MEDIAN-FILTERED value
  // rather than the raw one -- so without this the raw read is simply gone.
  n += snprintf(body + n, sizeof body - n, "],\"raw_mv\":[");
  for (size_t i = 0; i < BATCH_N && n > 0 && n < (int)sizeof body; i++)
    n += snprintf(body + n, sizeof body - n, i ? ",%.3f" : "%.3f", raw[i]);
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
  Serial.printf("POST %d seq=%lu\n", code, (unsigned long)seq);
  if (code < 0) Serial.printf("  %s\n", http.errorToString(code).c_str());
  else if (code >= 400) Serial.printf("  %s\n", http.getString().c_str());
  http.end();
}

// Log BEFORE energising, never during. The motor's EMI makes serial unreadable
// while it runs -- pump_main.cpp measured 84-440KB of framing garbage per run
// against 260 clean bytes idle. Blocking is deliberate too: plant 1's readings
// during the run would be that same EMI, so a 1.5s gap in the trace is more
// honest than 1.5s of noise pretending to be a signal.
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
  Serial.println("\nsaplink combo node: plant 1 senses, plant 2 gets watered");
  Serial.println("keys: r = inject recorded VP into plant 1, p = test pump");

  // 50kHz, not 100k: the electrode leads run alongside the bus and 100kHz threw
  // enough timeouts to lose samples. Nothing here needs the bandwidth.
  Wire.begin(SDA_PIN, SCL_PIN, 50000);
  ads_ok = ads.begin(0x48);
  // +-1.024V at 31uV/bit. The stem-vs-soil pair measures ~30mV, so this leaves
  // ~30x headroom while still resolving the sub-mV noise floor that the 3-sigma
  // threshold is computed from.
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
  // which silently pins a real sensor reading at the top of the range.
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);

  wifiUp();
}

void loop() {
  // Once per batch, not per sample: a keypress that lands mid-batch waits at
  // most 3.2s, and polling Serial 32 times a batch buys nothing.
  if (Serial.available()) {
    const int key = Serial.read();
    if (key == 'r') {
      Serial.println("replay: armed");
      player.trigger();
    } else if (key == 'p') {
      // Bench test only -- primes the line and proves the relay before a demo.
      // Deliberately NOT a stimulus path: the pump is in plant 2 and cannot
      // produce a signal on plant 1's electrode.
      actuate("manual test");
    }
  }

  uint32_t t_ms = millis();
  bool spike = false;
  bool replayed = false;
  float peak_mv = 0.0f;
  float threshold_mv = 0.0f;
  uint32_t spike_ms = 0;

  // Deadline, not a fixed post-read delay. readMv() now costs ~17ms, so
  // delay(PERIOD_MS) would make the true sample period ~117ms while Contract A
  // keeps claiming 100 -- and the dashboard timestamps every sample as
  // t_ms + i*period_ms, so that gap compounds across a batch. PeakDetector's
  // hold gate is counted in samples too, which only means a duration if the
  // period is what it says it is.
  uint32_t next_ms = t_ms;

  for (size_t i = 0; i < BATCH_N; i++) {
    float raw = readMv(seq * BATCH_N + i);
    float injected;
    // SUPERIMPOSED, not substituted. The waveform is 0-centred; replacing the
    // read would step the baseline by the electrode's whole standing offset and
    // read as an artifact rather than a VP. Riding the live baseline is what a
    // real deflection does.
    if (player.nextSample(injected)) {
      raw += injected;
      replayed = true;
    }
    // Captured BEFORE conditioning and before nothing else -- this is the only
    // record of what the ADC actually saw. On a replay batch it stays
    // pre-injection, so raw_mv and mv differ by exactly the injected waveform
    // and the replay flag explains why.
    raw_buf[i] = raw;
    cond.update(raw);
    // Deviation, not the raw reading. The frontend gets a trace centred on zero
    // with the electrode's polarization drift already subtracted out -- raw mV
    // wanders tens of millivolts over minutes and cannot be drawn on a fixed
    // axis. baseline_mv carries the absolute value for anyone who wants it.
    buf[i] = cond.deviation();
    // Sigma is measured, not assumed: on a settled electrode it sits near the
    // 0.031mV floor, so a real deflection clears 3-sigma by a wide margin.
    // Gated on warm() -- before sigma has converged the threshold is far too
    // low and every batch reports a spike, which is exactly what hardware did.
    if (cond.warm() && det.check(cond.deviation(), cond.sigma())) {
      spike = true;
      spike_ms = millis();
      // Taken from the detector, NOT scanned out of this batch. A deflection is
      // tracked across batches, so its peak often lives in the previous one --
      // scanning locally reported 4.128mV against a 4.964mV threshold on
      // hardware, a voltage that had supposedly cleared a higher bar.
      peak_mv = det.lastPeak();
      threshold_mv = det.lastThreshold();
    }
    // Signed comparison: if a sample overran its slot the wait is negative and
    // this must fall through immediately, not wrap to a 49-day delay.
    next_ms += PERIOD_MS;
    int32_t wait_ms = (int32_t)(next_ms - millis());
    if (wait_ms > 0) delay((uint32_t)wait_ms);
  }
  const uint32_t soil_mv = readSoilMv();

  // Sample first, network second. Conditioning no longer sits behind wifiUp():
  // a dropped connection used to stop the pipeline dead, so a demo that lost
  // Wi-Fi lost its signal too, and this path could not be checked at all
  // without working credentials. The batch is conditioned and printed either
  // way, and this line is exactly what the frontend would have received.
  Serial.printf("seq=%lu src=%s baseline=%.3fmv sigma=%.3fmv soil=%lumv %s%s\n",
                (unsigned long)seq, SRC, cond.baseline(), cond.sigma(),
                (unsigned long)soil_mv, spike ? "SPIKE" : "",
                replayed ? " [replay]" : "");

  // Ingestion is event-driven: a quiet plant uploads nothing. What gets sent is
  // the window AROUND an event -- the batch before it (the onset, already past
  // by the time the detector confirms a rebound), the batch it fired in, and
  // the one after (the tail). ~9.6s of waveform per event, silence either side.
  const bool heartbeat =
      kHeartbeatMs && (millis() - last_upload_ms >= kHeartbeatMs);
  bool sent_this_batch = false;

  if (wifiUp()) {
    if (spike) {
      if (prev_valid && !prev_sent) {
        seq--;  // the held-back batch keeps its own sequence number
        post(prev_t_ms, prev_baseline, false, prev_soil_mv, prev_buf,
             prev_raw_buf, prev_replayed);
        seq++;
      }
      post(t_ms, cond.baseline(), true, soil_mv, buf, raw_buf, replayed);
      sent_this_batch = true;

      // Contract B. event_type distinguishes an injected VP from a real one --
      // src stays "ads1115" either way because the ADC genuinely is live, so
      // without this the dashboard cannot tell them apart.
      PacketSchema pkt;
      pkt.node_id = NODE_ID;
      pkt.event_type = replayed ? EventType::REPLAY_TRIGGER : EventType::VP_SPIKE;
      // Magnitude, not the signed value. A VP deflects negative, and the
      // threshold is a positive bar, so shipping the sign here would make
      // voltage_mv < threshold_mv on the wire and read as "did not clear" all
      // over again. Nothing is lost: the signed waveform is in the readings
      // batch posted alongside this, sample by sample.
      pkt.voltage_mv = fabsf(peak_mv);
      pkt.threshold_mv = threshold_mv;
      pkt.timestamp_ms = spike_ms;
      cloud.postAlert(pkt);

      send_tail = true;
    } else if (send_tail) {
      post(t_ms, cond.baseline(), false, soil_mv, buf, raw_buf, replayed);
      sent_this_batch = true;
      send_tail = false;
    } else if (heartbeat) {
      post(t_ms, cond.baseline(), false, soil_mv, buf, raw_buf, replayed);
      sent_this_batch = true;
    }
    if (sent_this_batch) last_upload_ms = millis();

    // Close the route. The board does NOT pump on its own detection -- it pumps
    // on an event the backend handed back, which is the whole point of routing
    // through the cloud instead of writing an if-statement here.
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
          Serial.printf("cooldown, skipped id=%d\n", alert_id);
        } else {
          actuate("alert");
        }
      }
    }
  }

  memcpy(prev_buf, buf, sizeof buf);
  memcpy(prev_raw_buf, raw_buf, sizeof raw_buf);
  prev_t_ms = t_ms;
  prev_baseline = cond.baseline();
  prev_soil_mv = soil_mv;
  prev_replayed = replayed;
  prev_valid = true;
  prev_sent = sent_this_batch;
  seq++;
}
