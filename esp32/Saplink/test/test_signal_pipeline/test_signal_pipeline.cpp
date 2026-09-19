#include <unity.h>

#include <cmath>

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
    if (det.check(filtered, cond.sigma())) fired = true;
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
    if (det.check(filtered, cond.sigma())) fired = true;
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

// The alert's voltage_mv must be the deflection that actually fired, and
// threshold_mv the bar it cleared -- so voltage >= threshold, always. This
// failed on hardware (voltage_mv 4.128 against threshold_mv 4.964) because the
// caller scanned only the current 32-sample batch for a maximum, while the
// detector tracks a deflection ACROSS batches. A VP that straddles the
// boundary put its real peak in the previous batch, out of the caller's reach.
void test_peak_reported_when_vp_straddles_batch_boundary() {
  SignalConditioner cond;
  PeakDetector det;
  RecordedSignalPlayer player;

  for (int i = 0; i < 200; i++) cond.update(30.0f);

  const int kBatchN = 32;  // matches combo_main.cpp
  // Start the VP 20 samples into a batch. Its peak then lands at ~sample 30
  // (batch 0) while the rebound only confirms at ~sample 41 (batch 1) -- so the
  // batch that DETECTS the spike is not the batch that contains its peak. That
  // offset is the whole point; without it the waveform fires inside one batch
  // and the bug is invisible.
  const int kOffsetIntoBatch = 20;

  bool fired = false;
  float sample;
  int n = 0;
  float batch_max = 0.0f;
  bool triggered = false;

  while (n < kBatchN * 3) {
    if (n == kOffsetIntoBatch) {
      player.trigger();
      triggered = true;
    }
    float v = 30.0f;
    if (triggered && player.nextSample(sample)) v += sample;
    cond.update(v);

    // Reset per batch, exactly as the old per-batch scan in combo_main did.
    if (n % kBatchN == 0) batch_max = 0.0f;
    if (std::fabs(cond.deviation()) > std::fabs(batch_max)) batch_max = cond.deviation();
    n++;

    if (det.check(cond.deviation(), cond.sigma())) {
      fired = true;
      TEST_ASSERT_TRUE_MESSAGE(n > kBatchN,
                               "fixture must straddle a batch boundary to be a regression test");
      // The invariant that broke in production.
      TEST_ASSERT_TRUE_MESSAGE(
          std::fabs(det.lastPeak()) >= det.lastThreshold(),
          "reported peak must clear the threshold it was judged against");
      // And the old approach must genuinely have been wrong here, otherwise
      // this test would pass even with the bug still in place.
      TEST_ASSERT_TRUE_MESSAGE(
          std::fabs(det.lastPeak()) > std::fabs(batch_max),
          "per-batch scan should under-report -- fixture no longer exercises the bug");
      break;
    }
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
  RUN_TEST(test_peak_reported_when_vp_straddles_batch_boundary);
  return UNITY_END();
}
