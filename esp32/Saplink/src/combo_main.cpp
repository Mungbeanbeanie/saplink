#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "secrets.h"

// 10 Hz into a 32-sample buffer -> one POST every ~3.2s.
static const uint32_t PERIOD_MS = 100;
static const size_t BATCH_N = 32;

// "sim" until an ADC is actually wired. The backend records this, so on stage
// you can always tell a live trace from a synthetic one.
static const char *SRC = "sim";

static float buf[BATCH_N];
static uint32_t seq = 0;

// THE SEAM. Nothing is wired to this board yet, so this returns a synthetic
// trace: slow baseline wander plus a spike every ~20s, which gives the
// dashboard a realistic shape instead of a flat line. When the ADS1115 is
// connected, replace this body with a real differential read and set SRC to
// "ads1115" -- nothing else in this file changes.
static float readMv(uint32_t n) {
  float wander = 3.0f * sinf(n * 0.004f);
  float spike = (n % 200) < 8 ? 45.0f : 0.0f;
  float noise = 0.4f * (random(-100, 101) / 100.0f);
  return wander + spike + noise;
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

static void post(uint32_t t_ms) {
  float sum = 0;
  for (size_t i = 0; i < BATCH_N; i++) sum += buf[i];

  // One fixed-shape object; snprintf beats pulling in a JSON library for it.
  char body[1024];
  int n = snprintf(body, sizeof body,
                   "{\"device\":\"%s\",\"seq\":%lu,\"t_ms\":%lu,\"period_ms\":%lu,"
                   "\"baseline_mv\":%.3f,\"event\":null,\"src\":\"%s\",\"mv\":[",
                   DEVICE_ID, (unsigned long)seq, (unsigned long)t_ms,
                   (unsigned long)PERIOD_MS, sum / BATCH_N, SRC);
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
  wifiUp();
}

void loop() {
  if (!wifiUp()) {
    delay(2000);
    return;
  }
  uint32_t t_ms = millis();
  for (size_t i = 0; i < BATCH_N; i++) {
    buf[i] = readMv(seq * BATCH_N + i);
    delay(PERIOD_MS);
  }
  post(t_ms);
  seq++;
}
