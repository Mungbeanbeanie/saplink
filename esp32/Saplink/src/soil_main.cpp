#include <Arduino.h>

// ponytail: is the soil probe driving ANY analog pin? GPIO34 read a flat raw 0,
// same as a bare pin, so this sweeps all of ADC1 rather than trusting one pin
// number -- if AOUT actually landed in a neighbouring header hole, this finds it.
// ADC1 only: ADC2 (GPIO0/2/4/12-15/25-27) stops working once WiFi is up, so the
// real sensor pin has to be one of these six anyway.
static const uint8_t ADC1_PINS[] = {32, 33, 34, 35, 36, 39};

// Averaged: ESP32 ADC1 jitters tens of mV read to read, which reads as "the
// probe is responding" when nothing has moved.
static uint32_t readMv(uint8_t pin) {
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) sum += analogReadMilliVolts(pin);
  return sum / 16;
}

// Positive control. Without it, an all-zero sweep is ambiguous: dead sensor and
// dead ADC read identically. GPIO33 has an internal pull-up (34-39 do not), so
// pulling it high must show ~3.3V -- if it doesn't, the fault is in here, not
// in the wiring. Restored to a plain input afterwards so the sweep stays honest.
static uint32_t adcSelfTest() {
  pinMode(33, INPUT_PULLUP);
  delay(20);
  const uint32_t mv = readMv(33);
  pinMode(33, INPUT);
  return mv;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  // 11dB = full 0-3.3V span. The core's default is 0-1.1V on some versions,
  // which silently pins any real sensor reading at the top of the range.
  for (uint8_t p : ADC1_PINS) analogSetPinAttenuation(p, ADC_11db);
  Serial.printf("\nadc self-test: GPIO33 pulled up reads %lumv (expect ~3100+)\n",
                adcSelfTest());
  Serial.println("sweeping ADC1. a powered sensor sits well off 0; bare pins sit at 0.");
}

// Span since boot, per pin. A steady reading only proves a pin is driven; the
// probe is only actually *sensing* if wetting it moves that pin and not the
// others. Printed as a running span so a dip can be done one-handed, without
// having to catch the exact line it happened on.
static uint32_t lo[sizeof(ADC1_PINS)], hi[sizeof(ADC1_PINS)];

void loop() {
  Serial.print("mv:");
  for (size_t i = 0; i < sizeof(ADC1_PINS); i++) {
    const uint32_t mv = readMv(ADC1_PINS[i]);
    if (!hi[i]) lo[i] = hi[i] = mv;  // first pass; readings are never 0mv
    lo[i] = min(lo[i], mv);
    hi[i] = max(hi[i], mv);
    Serial.printf("  %u=%4lu(±%lu)", ADC1_PINS[i], mv, hi[i] - lo[i]);
  }
  Serial.println();
  delay(500);
}
