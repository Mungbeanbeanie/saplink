#include <Adafruit_ADS1X15.h>
#include <Arduino.h>
#include <Wire.h>

// ponytail: is A0/A1 a real channel? A2/A3 is the yardstick that the bus and
// this sketch's own logic are working -- NOT a target for A0/A1 to match. A2/A3
// is chlorided Ag/AgCl in one plant; A0/A1 is bare stainless pins in another.
// Two steel pins are a non-reversible pair: whatever oxide each has grown sets
// the offset, so it runs to hundreds of mV with an arbitrary sign, polarizes
// hard, and drifts far longer than silver does. Scoring A0/A1 by closeness to
// A2/A3's numbers would fail a channel that works fine, so what gets tested
// here is liveness, common-mode and range -- not agreement.
static const uint8_t SDA_PIN = 21, SCL_PIN = 22;

// GPIO26 drives the pump relay ACTIVE-HIGH, and floating it measured 1482mv,
// which an active-high module can read as ON (see soil_main.cpp). This sketch
// has nothing to do with the pump, which is exactly why it has to hold the pin
// down: every sketch flashed onto this board does.
static const uint8_t RELAY_PIN = 26;

static Adafruit_ADS1115 ads;
static bool ads_ok = false;

// The ADS1115 measures BOTH inputs of a pair against its own GND, so electrodes
// in a pot with no galvanic path back to the ESP32's ground float until input
// leakage parks them somewhere. Outside this window the differential still
// returns a plausible-looking number that means nothing -- the most likely
// failure for a second pot, and invisible unless the single-ended levels are
// read too. Absolute max is GND-0.3..VDD+0.3; this sits well inside that so the
// verdict fires before the readings go nonlinear rather than after.
static const float kCommonMinMv = 100.0f, kCommonMaxMv = 3200.0f;

// Even a settled electrode shows the ADC's own noise, so a pair quieter than
// this is not settled, it is disconnected. Two values because the electrodes
// are not comparable: silver settles to sub-mV, stainless never gets near that,
// so a steel pair reading this quiet is dead for certain.
// ponytail: calibration knobs. Raise either if a known-good pair reads FLAT.
static const float kFlatAgClMv = 0.1f;   // ~3 LSB at GAIN_FOUR (31uV each)
static const float kFlatSteelMv = 0.3f;

// Full scale is +-32768 counts. This close to it the input is riding the rail
// and the mean is a floor, not a measurement.
static const int16_t kSatCounts = 32000;

// x2 pairs x ~5ms per single-shot read at 50kHz = ~320ms, about 19 mains cycles
// at 60Hz, so hum averages out of the means.
static const int kSamples = 32;

// Highest gain (smallest full scale) whose range still clears the offset with
// 2x headroom. A fixed GAIN_FOUR is right for the ~97mV Ag/AgCl pair and would
// report a working steel pair as SATURATED the moment its offset passed 1.024V:
// the gain has to follow the pair, not the other way round.
struct GainStep {
  adsGain_t g;
  float fs_mv;
  const char *name;
};

// Capped at GAIN_FOUR, and not for range. The front end is switched-capacitor,
// so its input impedance falls as gain rises (~710k at GAIN_SIXTEEN). Staying
// at or below GAIN_FOUR keeps the load on a high-impedance steel pair in the
// same regime the known-good probe already runs in.
static const GainStep kGains[] = {
    {GAIN_FOUR, 1024.0f, "4"},
    {GAIN_TWO, 2048.0f, "2"},
    {GAIN_ONE, 4096.0f, "1"},
    {GAIN_TWOTHIRDS, 6144.0f, "2/3"},
};

static const GainStep &pickGain(float mv) {
  for (const GainStep &s : kGains)
    if (fabsf(mv) * 2.0f < s.fs_mv) return s;
  return kGains[3];  // past +-3V: nothing fits, report it at the widest range
}

struct Acc {
  float mn = 1e9f, mx = -1e9f;
  double sum = 0;
  int n = 0;
  int peak = 0;  // largest magnitude in counts, for the saturation test

  void add(float mv, int16_t counts) {
    mn = min(mn, mv);
    mx = max(mx, mv);
    sum += mv;
    n++;
    const int mag = counts < 0 ? -(int)counts : counts;  // int: -32768 negates
    if (mag > peak) peak = mag;
  }
  float mean() const { return n ? (float)(sum / n) : NAN; }
  float p2p() const { return n ? mx - mn : NAN; }
};

// Caller sets the gain; computeVolts() scales by whatever gain is current, so
// the two must not be separated.
static float seMv(uint8_t ch, int n) {
  double sum = 0;
  for (int i = 0; i < n; i++) sum += ads.computeVolts(ads.readADC_SingleEnded(ch));
  return (float)(sum / n) * 1000.0f;
}

// Order matters: an out-of-range pair can still produce a lively-looking
// differential, so common-mode is tested before anything derived from it.
static const char *verdict(float se_p, float se_n, const Acc &a, float flat_mv) {
  if (se_p < kCommonMinMv || se_p > kCommonMaxMv || se_n < kCommonMinMv ||
      se_n > kCommonMaxMv)
    return "OUT-OF-RANGE (floating -- needs a shared reference)";
  if (a.peak > kSatCounts) return "SATURATED (wiring fault -- soil makes no 6V)";
  if (a.p2p() < flat_mv) return "FLAT (open, shorted or dead)";
  return "LIVE";
}

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);  // first, before anything slow
  Serial.begin(115200);
  delay(300);

  // 50kHz, not 100k. Long unshielded electrode wires run alongside the bus and
  // 100kHz was timing out often enough to lose half the samples (probe_main).
  Wire.begin(SDA_PIN, SCL_PIN, 50000);
  ads_ok = ads.begin(0x48);
  // 860SPS so 32 samples stay a fraction of a second instead of a full one.
  ads.setDataRate(RATE_ADS1115_860SPS);

  Serial.printf("\n--- adscheck: ads.begin(0x48)=%d ---\n", ads_ok);
  Serial.println("A0-A1 = stainless pins (gain auto-ranged to fit their offset)");
  Serial.println("A2-A3 = Ag/AgCl, pinned at g=4 -- the control, not a target");
  Serial.println("se[..] = each input vs GND; both must sit mid-rail or the");
  Serial.println("         differential beside them is fiction.\n");
}

void loop() {
  if (!ads_ok) {
    Serial.println("ADS1115 not responding at 0x48");
    delay(1000);
    return;
  }

  // 1. Common-mode census at +-6.144V, so a floating input reports WHERE on the
  //    rail it sits instead of merely pinning at the top of a narrower range.
  ads.setGain(GAIN_TWOTHIRDS);
  float se[4];
  for (uint8_t ch = 0; ch < 4; ch++) se[ch] = seMv(ch, 8);

  // 2. Size the steel pair's offset at the widest range, then fit the gain.
  const float probe01 = ads.computeVolts(ads.readADC_Differential_0_1()) * 1000.0f;
  const GainStep &g01 = pickGain(probe01);

  // 3. Interleaved statistics. Alternating, not batched: batching one pair then
  //    the other lets slow drift shared by both masquerade as a difference
  //    between them. Each pair is read at its own gain -- cheap, since the
  //    driver rewrites the config register on every single-shot conversion.
  Acc a01, a23;
  for (int i = 0; i < kSamples; i++) {
    ads.setGain(g01.g);
    int16_t c = ads.readADC_Differential_0_1();
    a01.add(ads.computeVolts(c) * 1000.0f, c);
    ads.setGain(GAIN_FOUR);  // A2/A3 stays where probe_main measured it
    c = ads.readADC_Differential_2_3();
    a23.add(ads.computeVolts(c) * 1000.0f, c);
  }

  // Line-to-line elapsed, not the sampling span: the means being differenced
  // are one full loop apart, so anything shorter overstates the drift.
  static uint32_t prev_ms = 0;
  static float prev01 = NAN, prev23 = NAN;
  const uint32_t now = millis();
  const uint32_t dt = prev_ms ? now - prev_ms : 0;
  const float d01 =
      (dt && !isnan(prev01)) ? (a01.mean() - prev01) * 1000.0f / dt : 0.0f;
  const float d23 =
      (dt && !isnan(prev23)) ? (a23.mean() - prev23) * 1000.0f / dt : 0.0f;
  prev_ms = now;
  prev01 = a01.mean();
  prev23 = a23.mean();

  Serial.printf(
      "%6.1fs  A0-A1 g=%-3s %+9.2fmv p2p %6.2f drift %+6.2f  se[%4.0f,%4.0f]  %s\n",
      now / 1000.0f, g01.name, a01.mean(), a01.p2p(), d01, se[0], se[1],
      verdict(se[0], se[1], a01, kFlatSteelMv));
  Serial.printf(
      "        A2-A3 g=4   %+9.2fmv p2p %6.2f drift %+6.2f  se[%4.0f,%4.0f]  %s"
      "  <- known good\n",
      a23.mean(), a23.p2p(), d23, se[2], se[3],
      verdict(se[2], se[3], a23, kFlatAgClMv));
}
