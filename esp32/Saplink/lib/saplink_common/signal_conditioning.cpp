#include "signal_conditioning.h"

#include <algorithm>
#include <cmath>

float SignalConditioner::median() const {
  int n = median_count_;
  float sorted[kMedianWindow];
  for (int i = 0; i < n; i++) sorted[i] = median_buf_[i];
  std::sort(sorted, sorted + n);
  return sorted[n / 2];
}

float SignalConditioner::update(float raw_mv) {

  // Seed rather than converge up from zero. A real electrode sits at a
  // tens-of-mV standing offset, and an EMA starting at 0.0f needs a full tau
  // (~10s at alpha 0.01 and 10Hz) to climb there -- so every boot would open
  // with a phantom 30mV decay, shaped exactly like the event this pipeline
  // exists to detect, and hand it to the frontend as real.
  // ponytail: a corrupted first sample poisons the seed, but it self-heals
  // within one tau and only ever on boot. Seed from a median-of-3 if that turns
  // out to happen in practice.
  if (!seeded_) {
    baseline_ = raw_mv;
    seeded_ = true;
  }

  median_buf_[median_next_] = raw_mv;
  median_next_ = (median_next_ + 1) % kMedianWindow;
  if (median_count_ < kMedianWindow) median_count_++;

  float filtered = median();
  // Against the baseline as it stood BEFORE this sample moved it: the question
  // is how far this reading departs from what was expected, not from a baseline
  // already partly dragged toward it.
  const float dev = filtered - baseline_;

  baseline_ += (filtered - baseline_) * alpha_;

  // Mean absolute deviation scaled to sigma (1.2533 * MAD for Gaussian noise).
  // Cheaper than RMS and far less sensitive to an outlier surviving the median.
  //
  // Running mean until the EMA's own alpha overtakes it (1/n falls below
  // kSigmaAlpha at n=1000). Seeding mad_ at 0 and creeping up at alpha 0.001
  // leaves sigma badly under-estimated for the first ~100s -- and on hardware
  // every single batch came back SPIKE, because 3*sigma of a half-formed sigma
  // is cleared by ordinary drift. The baseline had this same cold start; this
  // is the same bug in the other estimator.
  samples_++;
  mad_ += (std::fabs(dev) - mad_) * std::fmax(kSigmaAlpha, 1.0f / samples_);
  sigma_ = std::fmax(mad_ * 1.2533f, kSigmaFloorMv);

  filtered_ = filtered;
  return filtered;
}
