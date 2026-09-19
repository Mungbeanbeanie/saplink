#include <Adafruit_ADS1X15.h>
#include <Arduino.h>
#include <Wire.h>

// ponytail: one sketch that shows every sensor at once -- the two moisture
// probes on GPIO, and all four ADS1115 channels. Liveness is judged the same
// way everywhere: a driven input sits still, a floating one wanders. The
// spread IS the test, so every reading carries its peak-to-peak.
static const uint8_t SOIL_PINS[] = {34, 35};  // moisture sensor 1, 2
static const uint8_t BARE_PINS[] = {32, 36};  // known-empty, the contrast
static const uint8_t SDA_PIN = 21, SCL_PIN = 22;

// GPIO26 drives the pump relay and is ACTIVE-HIGH (measured). This sketch has
// nothing to do with the pump, which is exactly why it must drive the pin: left
// alone the pin floats, floating measured 1482mv, and an active-high module can
// read that as ON. Every sketch flashed onto this board holds it down.
static const uint8_t RELAY_PIN = 26;

static Adafruit_ADS1115 ads;
static bool ads_ok = false;

struct Stats {
  float mean, p2p;
};

static Stats sample(float (*read)(uint8_t), uint8_t ch, int n) {
  float mn = 1e9f, mx = -1e9f;
  double sum = 0;
  for (int i = 0; i < n; i++) {
    const float v = read(ch);
    mn = min(mn, v);
    mx = max(mx, v);
    sum += v;
  }
  return {(float)(sum / n), mx - mn};
}

static float readGpio(uint8_t pin) { return analogReadMilliVolts(pin); }
static float readAds(uint8_t ch) {
  return ads.computeVolts(ads.readADC_SingleEnded(ch)) * 1000.0f;
}

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);  // first, before anything slow
  Serial.begin(115200);
  delay(300);

  // 11dB = full 0-3.3V. The core default is 0-1.1V on some versions, which
  // silently pins a real sensor at the top of the range.
  for (uint8_t p : SOIL_PINS) analogSetPinAttenuation(p, ADC_11db);
  for (uint8_t p : BARE_PINS) analogSetPinAttenuation(p, ADC_11db);

  Wire.begin(SDA_PIN, SCL_PIN, 50000);  // 50k, per probe_main's timeout note
  ads_ok = ads.begin(0x48);
  // TWOTHIRDS (+-6.144V), NOT probe_main's GAIN_FOUR. This is a survey: it has
  // to show a 2V moisture sensor and a 100mV electrode on the same pass without
  // clipping either. Raise the gain once it is known what is actually on A1 --
  // GAIN_FOUR would clip anything above 1.024V and report a flat ceiling.
  ads.setGain(GAIN_TWOTHIRDS);
  // 860SPS so 128 samples span ~150ms (~9 mains cycles) instead of a full
  // second. Fast enough to stay watchable, long enough to average 60Hz away.
  ads.setDataRate(RATE_ADS1115_860SPS);
  Serial.printf("\nads.begin(0x48)=%d  gain=2/3 (+-6.144V, survey mode)\n", ads_ok);
  Serial.println("driven inputs sit still; floating ones wander. watch p2p.\n");
}

void loop() {
  Serial.print("gpio ");
  for (uint8_t p : SOIL_PINS) {
    const Stats s = sample(readGpio, p, 16);
    Serial.printf(" %u=%6.0fmv(p2p%4.0f)", p, s.mean, s.p2p);
  }
  Serial.print("   bare");
  for (uint8_t p : BARE_PINS) {
    const Stats s = sample(readGpio, p, 16);
    Serial.printf(" %u=%6.0f(p2p%4.0f)", p, s.mean, s.p2p);
  }
  Serial.println();

  if (ads_ok) {
    // 128 samples at 860SPS spans ~150ms = ~9 full mains cycles, so 60Hz hum
    // averages out to nothing. That is the whole discriminator: a floating input
    // is hum around an undefined level, so its MEAN keeps moving no matter how
    // much is averaged. A driven input has a real DC level underneath, so the
    // mean settles even while p2p stays large. Watch the means across lines,
    // not the p2p within one.
    Serial.print("ads  ");
    for (uint8_t ch = 0; ch < 4; ch++) {
      const Stats s = sample(readAds, ch, 128);
      Serial.printf(" A%u=%7.1f(p2p%5.0f)", ch, s.mean, s.p2p);
    }
    Serial.println();

    // The measurement that actually matters. Single-ended carries ~500mV of
    // mains hum on every electrode channel; differential subtracts it, because
    // hum arrives equally on both wires of a pair and the plant signal does
    // not. 2_3 is the known-good pair from probe_main -- it is the yardstick
    // here, not just another reading. If 0_1's hum does not collapse the way
    // 2_3's does, the new probe has no usable partner on A0.
    Stats d01 = sample([](uint8_t) -> float {
      return ads.computeVolts(ads.readADC_Differential_0_1()) * 1000.0f;
    }, 0, 128);
    Stats d23 = sample([](uint8_t) -> float {
      return ads.computeVolts(ads.readADC_Differential_2_3()) * 1000.0f;
    }, 0, 128);
    Serial.printf("diff  0-1=%7.1f(p2p%5.0f)   2-3=%7.1f(p2p%5.0f)  <- known good\n",
                  d01.mean, d01.p2p, d23.mean, d23.p2p);
  } else {
    Serial.println("ads   NOT RESPONDING at 0x48");
  }
  delay(500);
}
