#include <unity.h>

#include "peak_detector.h"
#include "recorded_signal.h"
#include "signal_conditioning.h"

void setUp() {}
void tearDown() {}

void test_noise_only_does_not_fire() {
  SignalConditioner cond;
  PeakDetector det;

  // Deterministic +-0.5mV jitter, no trend -- must never look like a spike.
  const float noise[] = {0.1f,  -0.3f, 0.2f,  -0.5f, 0.4f,  -0.1f, 0.3f,
                          -0.4f, 0.0f,  0.5f,  -0.2f, 0.1f,  -0.5f, 0.3f,
                          -0.1f, 0.2f,  -0.3f, 0.4f,  -0.4f, 0.0f};

  bool fired = false;
  for (float raw : noise) {
    float filtered = cond.update(raw);
    if (det.check(filtered, 1.0f)) fired = true;
  }

  TEST_ASSERT_FALSE(fired);
}

void test_recorded_waveform_fires() {
  SignalConditioner cond;
  PeakDetector det;
  RecordedSignalPlayer player;

  player.trigger();

  bool fired = false;
  float sample;
  while (player.nextSample(sample)) {
    float filtered = cond.update(sample);
    if (det.check(filtered, 1.0f)) fired = true;
  }

  TEST_ASSERT_TRUE(fired);
}

// A real electrode sits at a standing offset -- 30mV stem-vs-soil, measured on
// this rig. With baseline_ starting at 0.0f that offset read as a 30mV
// deflection for a full tau after boot, firing the detector and handing the
// frontend a phantom spike in its first batch. Every boot, forever.
void test_cold_start_offset_does_not_fire() {
  SignalConditioner cond;
  PeakDetector det;

  bool fired = false;
  for (int i = 0; i < 64; i++) {
    cond.update(30.0f);
    if (det.check(cond.deviation(), cond.sigma())) fired = true;
  }

  TEST_ASSERT_FALSE(fired);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, cond.deviation());
}

// A dead-flat input drives the MAD estimate to zero. Unfloored, the 3*sigma
// threshold collapses to 0 and every subsequent sample clears it.
void test_sigma_floors_above_zero() {
  SignalConditioner cond;
  for (int i = 0; i < 500; i++) cond.update(30.0f);

  TEST_ASSERT_TRUE(cond.sigma() > 0.0f);
}

// Sigma is estimated from the data, so before it has converged the 3*sigma
// threshold is meaningless and clears on ordinary drift. On hardware that meant
// every batch reported SPIKE. warm() must stay false until sigma means
// something -- and a caller that honours it must see nothing during that window.
void test_warmup_suppresses_detection() {
  SignalConditioner cond;
  PeakDetector det;

  bool fired = false;
  for (int i = 0; i < 100; i++) {
    // Drifting, exactly like a polarizing electrode: the case that mis-fired.
    cond.update(30.0f + 0.01f * i);
    if (cond.warm() && det.check(cond.deviation(), cond.sigma())) fired = true;
  }

  TEST_ASSERT_FALSE(cond.warm());
  TEST_ASSERT_FALSE(fired);
}

// The offset must not be mistaken for signal, but a real deflection ON TOP of
// that offset still has to fire -- the fix has to remove the drift, not the
// sensitivity.
void test_deflection_on_top_of_offset_fires() {
  SignalConditioner cond;
  PeakDetector det;
  RecordedSignalPlayer player;

  for (int i = 0; i < 200; i++) cond.update(30.0f);  // settle at the offset

  player.trigger();
  bool fired = false;
  float sample;
  while (player.nextSample(sample)) {
    cond.update(30.0f + sample);
    if (det.check(cond.deviation(), cond.sigma())) fired = true;
  }

  TEST_ASSERT_TRUE(fired);
}

int main(int argc, char **argv) {
  UNITY_BEGIN();
  RUN_TEST(test_noise_only_does_not_fire);
  RUN_TEST(test_recorded_waveform_fires);
  RUN_TEST(test_cold_start_offset_does_not_fire);
  RUN_TEST(test_sigma_floors_above_zero);
  RUN_TEST(test_warmup_suppresses_detection);
  RUN_TEST(test_deflection_on_top_of_offset_fires);
  return UNITY_END();
}
