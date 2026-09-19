#include <Arduino.h>

// ponytail: pump liveness check, and the record of how the relay is wired.
// Polarity was determined on the bench, not from the silkscreen: the sketch
// pulsed GPIO26 low (one run) and high (two taps) and let the pump itself say
// which fired, because the motor's EMI makes serial useless mid-run. It
// double-tapped -- so this module is ACTIVE-HIGH.
static const uint8_t RELAY_PIN = 26;   // relay IN
static const int RELAY_ON = HIGH;      // measured, not assumed
static const int RELAY_OFF = LOW;

// Calibration knob: long enough to move visible fluid, short enough not to
// empty the reservoir while someone is watching the bench.
static const uint32_t kRunMs = 1500;
static const uint32_t kRestMs = 5000;

void setup() {
  // Driven OFF before anything else. At reset GPIO26 floats, and a floating IN
  // on an active-high module is undefined -- measured at 1482mv, which is above
  // logic-low. Establish the level first, then do everything slower.
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);
  Serial.begin(115200);
  delay(300);
  Serial.println("\npump: GPIO26 active-HIGH. running 1.5s every 5s.");
}

void loop() {
  // Printed BEFORE the motor starts, deliberately. Anything printed while it
  // runs is lost: 84-440KB of unreadable framing per run against 260 clean
  // bytes idle. Log intent ahead of the actuation, never during it.
  Serial.printf("pump ON  t=%lu\n", millis());
  digitalWrite(RELAY_PIN, RELAY_ON);
  delay(kRunMs);
  digitalWrite(RELAY_PIN, RELAY_OFF);
  Serial.printf("pump OFF t=%lu\n", millis());
  delay(kRestMs);
}
