#include <Arduino.h>

// ponytail: emergency stop. Holds the relay pin at its de-energized level and
// does nothing else, ever. Exists because "flash blink to make it safe" is
// wrong here -- blink never touches GPIO26, so the pin floats, and a floating
// IN measured 1482mv, which an active-HIGH module can read as ON. Safe means
// DRIVEN off, not untouched.
static const uint8_t RELAY_PIN = 26;
static const int RELAY_OFF = LOW;  // active-HIGH module, measured on the bench

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);  // first statement, before anything slow
  Serial.begin(115200);
  delay(300);
  Serial.println("\nrelay held OFF. if the pump is STILL running, the relay");
  Serial.println("contacts are stuck -- firmware cannot fix that, pull power.");
}

void loop() {
  // Re-assert rather than trusting the pin to stay put. Costs nothing and
  // covers a glitch or an ESD event flipping the latch.
  digitalWrite(RELAY_PIN, RELAY_OFF);
  Serial.printf("relay OFF t=%lu\n", millis());
  delay(1000);
}
