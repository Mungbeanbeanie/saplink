#include "signal_conditioning.h"

#include <algorithm>

float SignalConditioner::median() const {
  int n = median_count_;
  float sorted[kMedianWindow];
  for (int i = 0; i < n; i++) sorted[i] = median_buf_[i];
  std::sort(sorted, sorted + n);
  return sorted[n / 2];
}

float SignalConditioner::update(float raw_mv) {
  median_buf_[median_next_] = raw_mv;
  median_next_ = (median_next_ + 1) % kMedianWindow;
  if (median_count_ < kMedianWindow) median_count_++;

  float filtered = median();
  baseline_ += (filtered - baseline_) * alpha_;
  return filtered;
}
