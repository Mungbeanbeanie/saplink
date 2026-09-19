#include <Adafruit_ADS1X15.h>
#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>

#include "peak_detector.h"
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

static Adafruit_ADS1115 ads;
static bool ads_ok = false;

static SignalConditioner cond;
static PeakDetector det;

// 10 Hz into a 32-sample buffer -> one POST every ~3.2s.
static const uint32_t PERIOD_MS = 100;
static const size_t BATCH_N = 32;

// "sim" until an ADC is actually wired. The backend records this, so on stage
// you can always tell a live trace from a synthetic one.
static const char *SRC = "sim";

static float buf[BATCH_N];
static uint32_t seq = 0;

// THE SEAM, now crossed: the ADS1115 is wired and A2-A3 is read for real. The
// synthetic trace stays as the fallback so a loose wire degrades the demo to a
// realistic shape rather than a flat line, and SRC records which one produced
// the batch -- on stage a live trace must never be mistaken for a simulated one.
static float readMv(uint32_t n) {
  if (ads_ok) return ads.computeVolts(ads.readADC_Differential_2_3()) * 1000.0f;
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
static void post(uint32_t t_ms, float baseline_mv, bool spike, uint32_t soil_mv) {
  // One fixed-shape object; snprintf beats pulling in a JSON library for it.
  char body[1024];
  int n = snprintf(body, sizeof body,
                   "{\"device\":\"%s\",\"seq\":%lu,\"t_ms\":%lu,\"period_ms\":%lu,"
                   "\"baseline_mv\":%.3f,\"event\":%s,\"src\":\"%s\","
                   "\"soil_mv\":%lu,\"mv\":[",
                   DEVICE_ID, (unsigned long)seq, (unsigned long)t_ms,
                   (unsigned long)PERIOD_MS, baseline_mv,
                   spike ? "\"spike\"" : "null", SRC,
                   (unsigned long)soil_mv);
  for (size_t i = 0; i < BATCH_N && n > 0 && n < (int)sizeof body; i++)
    n += snprintf(body + n, sizeof body - n, i ? ",%.3f" : "%.3f", buf[i]);
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

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\nsaplink sense node");

  // 50kHz, not 100k: the electrode leads run alongside the bus and 100kHz threw
  // enough timeouts to lose samples. Nothing here needs the bandwidth.
  Wire.begin(SDA_PIN, SCL_PIN, 50000);
  ads_ok = ads.begin(0x48);
  // +-1.024V at 31uV/bit. The stem-vs-soil pair measures ~30mV, so this leaves
  // ~30x headroom while still resolving the sub-mV noise floor that the 3-sigma
  // threshold is computed from.
  ads.setGain(GAIN_FOUR);
  SRC = ads_ok ? "ads1115" : "sim";
  Serial.printf("ads1115 @0x48: %s -> src=%s\n", ads_ok ? "ok" : "ABSENT", SRC);

  // 11dB = full 0-3.3V span; the core defaults to 0-1.1V on some versions,
  // which silently pins a real sensor reading at the top of the range.
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);

  wifiUp();
}

void loop() {
  uint32_t t_ms = millis();
  bool spike = false;
  for (size_t i = 0; i < BATCH_N; i++) {
    cond.update(readMv(seq * BATCH_N + i));
    // Deviation, not the raw reading. The frontend gets a trace centred on zero
    // with the electrode's polarization drift already subtracted out -- raw mV
    // wanders tens of millivolts over minutes and cannot be drawn on a fixed
    // axis. baseline_mv carries the absolute value for anyone who wants it.
    buf[i] = cond.deviation();
    // Sigma is measured, not assumed: on a settled electrode it sits near the
    // 0.031mV floor, so a real deflection clears 3-sigma by a wide margin.
    // Gated on warm() -- before sigma has converged the threshold is far too
    // low and every batch reports a spike, which is exactly what hardware did.
    if (cond.warm() && det.check(cond.deviation(), cond.sigma())) spike = true;
    delay(PERIOD_MS);
  }
  const uint32_t soil_mv = readSoilMv();

  // Sample first, network second. Conditioning no longer sits behind wifiUp():
  // a dropped connection used to stop the pipeline dead, so a demo that lost
  // Wi-Fi lost its signal too, and this path could not be checked at all
  // without working credentials. The batch is conditioned and printed either
  // way, and this line is exactly what the frontend would have received.
  Serial.printf("seq=%lu src=%s baseline=%.3fmv sigma=%.3fmv soil=%lumv %s\n",
                (unsigned long)seq, SRC, cond.baseline(), cond.sigma(),
                (unsigned long)soil_mv, spike ? "SPIKE" : "");
  if (wifiUp()) post(t_ms, cond.baseline(), spike, soil_mv);
  seq++;
}
