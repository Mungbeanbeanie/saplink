#include "cloud_client.h"

// ponytail: Arduino-only TU. The native test env compiles every .cpp in this
// library dir, and LDF gives no way to skip one file, so the guard lives here
// rather than as a per-file exclude list in platformio.ini that rots the moment
// a file is added.
#ifdef ARDUINO

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include <cstdio>
#include <cstring>

#include "secrets.h"

// ponytail: DEAD in the combo path -- combo_main.cpp's wifiUp() owns the
// connection and this class only ever rides an already-open one. Left as the
// stretch boards' entry point, but note it is single-SSID: it does NOT honour
// secrets.h's WIFI_NETWORKS fallback list. Route any new caller through a
// wifiUp()-equivalent instead of calling this, or the fallback silently
// stops applying.
bool CloudClient::begin() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("cloud_client: connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) delay(250);
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("cloud_client: wifi FAILED (status=%d)\n", WiFi.status());
    return false;
  }
  Serial.print("cloud_client: wifi ok ");
  Serial.println(WiFi.localIP());
  return true;
}

bool CloudClient::postAlert(const PacketSchema &pkt) {
  char body[256];
  snprintf(body, sizeof body,
           "{\"node_id\":%u,\"event_type\":\"%s\",\"voltage_mv\":%.3f,"
           "\"threshold_mv\":%.3f,\"timestamp_ms\":%lu}",
           pkt.node_id, eventTypeToString(pkt.event_type), pkt.voltage_mv,
           pkt.threshold_mv, (unsigned long)pkt.timestamp_ms);

  WiFiClientSecure client;
  client.setInsecure();  // see combo_main.cpp's post() -- same tradeoff.

  HTTPClient http;
  if (!http.begin(client, SAPLINK_API_BASE "/api/alerts")) {
    Serial.println("postAlert: begin failed");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " SAPLINK_TOKEN);
  int code = http.POST((uint8_t *)body, strlen(body));
  Serial.printf("postAlert %d\n", code);
  http.end();
  return code >= 200 && code < 300;
}

// Response shape here is NOT a locked contract -- Phase 5's GET
// /api/alerts/pending doesn't exist yet. Assumed flat JSON with an "id" field
// on top of Contract B's fields; 404/empty body means nothing pending. Must
// be reconciled once Phase 5 actually designs this response (see plan.md).
static bool extractInt(const char *body, const char *key, long &out) {
  const char *p = strstr(body, key);
  if (!p) return false;
  p += strlen(key);
  return sscanf(p, "%ld", &out) == 1;
}

static bool extractFloat(const char *body, const char *key, float &out) {
  const char *p = strstr(body, key);
  if (!p) return false;
  p += strlen(key);
  return sscanf(p, "%f", &out) == 1;
}

static bool extractEventType(const char *body, EventType &out) {
  const char *key = "\"event_type\":\"";
  const char *p = strstr(body, key);
  if (!p) return false;
  p += strlen(key);
  out = (strncmp(p, "VP_SPIKE", 8) == 0) ? EventType::VP_SPIKE
                                          : EventType::REPLAY_TRIGGER;
  return true;
}

bool CloudClient::pollPendingAlert(PacketSchema &out, int &alert_id) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  if (!http.begin(client, SAPLINK_API_BASE "/api/alerts/pending")) {
    Serial.println("pollPendingAlert: begin failed");
    return false;
  }
  http.addHeader("Authorization", "Bearer " SAPLINK_TOKEN);
  int code = http.GET();
  if (code != 200) {
    http.end();
    return false;  // nothing pending (404), or a transport error -- same result here.
  }

  String body = http.getString();
  http.end();

  long id = 0, node_id = 0, timestamp_ms = 0;
  float voltage_mv = 0, threshold_mv = 0;
  EventType event_type;

  if (!extractInt(body.c_str(), "\"id\":", id)) return false;
  if (!extractInt(body.c_str(), "\"node_id\":", node_id)) return false;
  if (!extractEventType(body.c_str(), event_type)) return false;
  if (!extractFloat(body.c_str(), "\"voltage_mv\":", voltage_mv)) return false;
  if (!extractFloat(body.c_str(), "\"threshold_mv\":", threshold_mv)) return false;
  if (!extractInt(body.c_str(), "\"timestamp_ms\":", timestamp_ms)) return false;

  alert_id = (int)id;
  out.node_id = (uint8_t)node_id;
  out.event_type = event_type;
  out.voltage_mv = voltage_mv;
  out.threshold_mv = threshold_mv;
  out.timestamp_ms = (uint32_t)timestamp_ms;
  return true;
}

bool CloudClient::ackAlert(int alert_id) {
  char path[128];
  snprintf(path, sizeof path, "%s/api/alerts/%d/ack", SAPLINK_API_BASE, alert_id);

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  if (!http.begin(client, path)) {
    Serial.println("ackAlert: begin failed");
    return false;
  }
  http.addHeader("Authorization", "Bearer " SAPLINK_TOKEN);
  int code = http.POST((uint8_t *)"", 0);
  Serial.printf("ackAlert %d id=%d\n", code, alert_id);
  http.end();
  return code >= 200 && code < 300;
}

#endif  // ARDUINO
