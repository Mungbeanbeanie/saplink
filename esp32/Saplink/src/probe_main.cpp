#include <Adafruit_ADS1X15.h>
#include <Arduino.h>
#include <Wire.h>

// ponytail: reference-probe liveness check. The electrode lands on GPIO25 with
// the ADS1115 in the path, so "are we getting data?" has two possible answers
// depending on where the wire actually ends. Read both and let the numbers say.
#define PROBE_PIN 25  // ADC2_CH8 -- see the WiFi note in setup()
#define SDA_PIN 21
#define SCL_PIN 22

static Adafruit_ADS1115 ads;
static bool ads_ok = false;

// A dead input reads a flat number; an electrode in wet tissue wanders. One
// sample cannot tell those apart, so every read carries its spread -- the
// spread IS the liveness test, not the mean.
struct Stats {
  float mn, mx, mean;
};

typedef float (*ReadMv)(uint8_t);

static Stats sample(ReadMv read, uint8_t ch, int n) {
  Stats s{1e9f, -1e9f, 0};
  double sum = 0;
  for (int i = 0; i < n; i++) {
    const float mv = read(ch);
    s.mn = min(s.mn, mv);
    s.mx = max(s.mx, mv);
    sum += mv;
  }
  s.mean = sum / n;
  return s;
}

static float readGpioMv(uint8_t pin) {
  return analogReadMilliVolts(pin);  // uses the chip's factory ADC calibration
}

static float readAdsMv(uint8_t ch) {
  return ads.computeVolts(ads.readADC_SingleEnded(ch)) * 1000.0f;
}

static void print(const char *label, const Stats &s) {
  Serial.printf("  %-12s %8.2fmv  p2p %7.2f  [%.1f..%.1f]\n", label, s.mean,
                s.mx - s.mn, s.mn, s.mx);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n--- probe check: GPIO25 + ADS1115 ---");

  // GPIO25 is on ADC2, which the WiFi radio takes over when it starts. Fine
  // here (no WiFi in this sketch) but it WILL read garbage in combo_main once
  // WiFi is up -- move the probe to GPIO32-39 (ADC1) before wiring it in.
  analogSetPinAttenuation(PROBE_PIN, ADC_11db);  // full ~0-2.5V usable span

  // 50kHz, not 100k. Long unshielded electrode wires run alongside the bus and
  // 100kHz was timing out (Wire error 263) often enough to lose half the
  // samples. Slower bits buy noise margin, and nothing here needs the bandwidth.
  Wire.begin(SDA_PIN, SCL_PIN, 50000);
  ads_ok = ads.begin(0x48);
  // Measured: the stem-vs-soil pair sits at ~97mV. +-1.024V leaves 10x headroom
  // on that and drops the LSB from 188uV to 31uV, which is the difference
  // between seeing a plant spike and rounding it off. Drop back a step if the
  // offset ever drifts past ~800mV and starts clipping.
  ads.setGain(GAIN_FOUR);
  Serial.printf("ads.begin(0x48) = %d\n", ads_ok);
}

// ponytail: the 95mV standing offset is the boring part -- two dissimilar
// metals in an electrolyte hand you that for free, no plant required. What
// separates biology from a galvanic cell is DEVIATION, so track a slow baseline
// and report distance from it. Nothing here is a fixed voltage: the electrode
// pair drifts as it equilibrates, and an absolute threshold would false-trigger
// on that drift within a minute.
// Two EMAs, not one baseline. A single baseline has to be either fast enough to
// follow electrode settling or slow enough to preserve a plant response, and a
// freshly inserted electrode drifts ~1mV/s -- so one filter cannot do both and
// the fast/slow GAP does. Steady drift lags both filters by the same shape and
// cancels in the difference; only something moving faster than the slow filter
// survives. That is the whole trick.
static float fast = NAN, slow = NAN, prev_slow = NAN;

// ~20Hz: a plant response takes seconds, so the old ~100Hz bought no signal and
// cost half the samples to I2C timeouts. alpha = 1/(rate*tau), tau 1s and 15s.
static const uint32_t kSampleMs = 40;  // + ~8ms conversion = ~20Hz
static const int kSamplesPerLine = 20;
static const float kFastAlpha = 0.05f, kSlowAlpha = 0.0033f;

// 3mV, not 2. A slow filter still lags a drifting electrode by a millivolt or
// two, and at 2.0 that residual lag alone tripped the flag. Tighten this once
// drift is near zero and a real response has shown its actual amplitude.
static const float kSpikeMv = 3.0f;
// Below this the electrode has stopped polarizing and a flag can be believed.
// Freshly inserted it runs ~1mV/s; settled is nearer 0.05.
static const float kSettledMvPerS = 0.2f;

// No real sample moves this far in one 50ms step; anything that does is a
// corrupted I2C read. Well above the ~50mV a genuine plant response spans.
static const float kMaxStepMv = 50.0f;

void loop() {
  if (!ads_ok) {
    Serial.println("ADS1115 not responding");
    delay(1000);
    return;
  }

  float mn = 1e9f, mx = -1e9f;
  int n = 0, bad = 0;
  const uint32_t t0 = millis();
  for (int i = 0; i < kSamplesPerLine; i++) {
    const float mv =
        ads.computeVolts(ads.readADC_Differential_2_3()) * 1000.0f;
    if (isnan(fast)) fast = slow = mv;
    // One corrupted read off this timeout-prone bus lands hundreds of mV away
    // and, unguarded, reads out as an event: a single bad sample blew p2p to
    // 610mV and stepped the slow baseline 2mV, which the flag duly reported as
    // a spike. Plant signals move over seconds, so no honest sample jumps this
    // far in one 50ms step. Counted, not silently swallowed -- a rising bad
    // count is the bus degrading, and hiding that trades one lie for another.
    if (fabsf(mv - fast) > kMaxStepMv) {
      bad++;
      delay(kSampleMs);
      continue;
    }
    fast += (mv - fast) * kFastAlpha;
    slow += (mv - slow) * kSlowAlpha;
    mn = min(mn, mv);
    mx = max(mx, mv);
    n++;
    delay(kSampleMs);
  }
  if (n == 0) {  // every sample rejected: report it rather than divide by zero
    Serial.printf("%6.1fs  ALL %d SAMPLES REJECTED -- bus or electrode fault\n",
                  millis() / 1000.0f, kSamplesPerLine);
    return;
  }
  const uint32_t dt = millis() - t0;
  const float dev = fast - slow;
  // Drift is the settling progress meter: it says when the rig is ready to be
  // trusted, which matters more right now than any single reading.
  const float drift =
      isnan(prev_slow) ? 0.0f : (slow - prev_slow) * 1000.0f / dt;
  prev_slow = slow;
  // Re-read the bare pair every line: one conversion, and it is the only thing
  // separating "the plant did something" from "the whole rig shifted".
  const float ctrl = ads.computeVolts(ads.readADC_Differential_0_1()) * 1000.0f;

  // SPIKE outranks settling. A sharp event drives drift up by definition, so
  // testing drift first let the loudest moment in the last capture label itself
  // "settling" and hide -- the gate suppressed precisely what it exists to find.
  const bool settled = fabsf(drift) < kSettledMvPerS;
  Serial.printf("%6.1fs  A2-A3 %8.3f  dev %+7.3f  drift %+6.2fmv/s  p2p %5.3f"
                "  ctrl %+5.2f  n=%2d bad=%d  %s\n",
                millis() / 1000.0f, slow, dev, drift, mx - mn, ctrl, n, bad,
                fabsf(dev) > kSpikeMv ? "<<<<< SPIKE"
                                      : (settled ? "ready" : "settling"));
}
