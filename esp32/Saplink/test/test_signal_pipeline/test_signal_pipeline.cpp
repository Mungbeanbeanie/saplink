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

int main(int argc, char **argv) {
  UNITY_BEGIN();
  RUN_TEST(test_noise_only_does_not_fire);
  RUN_TEST(test_recorded_waveform_fires);
  return UNITY_END();
}
