#include <Arduino.h>

// ponytail: upload-path smoke test. GPIO2 is the onboard LED on esp32dev.
// Serial prints alongside the toggle so a dead or absent LED still tells you
// whether the board is actually running the firmware you just flashed.
static const uint8_t LED_PIN = 2;

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("\nblink: up");
}

void loop() {
  static bool on = false;
  on = !on;
  digitalWrite(LED_PIN, on);
  Serial.printf("blink %d t=%lu\n", on, millis());
  delay(500);
}
