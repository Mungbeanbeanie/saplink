#include "signal_conditioning.h"

#include <algorithm>
#include <cmath>
#include <cmath>

float SignalConditioner::median() const {
  int n = median_count_;
  float sorted[kMedianWindow];
  for (int i = 0; i < n; i++) sorted[i] = median_buf_[i];
  std::sort(sorted, sorted + n);
  return sorted[n / 2];
}

float SignalConditioner::sigma() const { return std::sqrt(variance_); }

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
  // Deflection from baseline, computed BEFORE this sample updates baseline_ --
  // this is the auto-zero subtraction the header/plan.md describe; returning
  // raw `filtered` here was the bug (PeakDetector would see absolute signal
  // level, not deflection, so baseline wander alone could look like a spike).
  float centered = filtered - baseline_;
  variance_ += (centered * centered - variance_) * alpha_;
  baseline_ += centered * alpha_;
  return centered;
}
