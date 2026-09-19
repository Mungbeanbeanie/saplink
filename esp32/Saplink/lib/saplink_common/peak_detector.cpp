#include "peak_detector.h"

#include <cmath>

bool PeakDetector::check(float conditioned_mv, float baseline_sigma) {
  const float threshold = 3.0f * baseline_sigma;
  const float mag = std::fabs(conditioned_mv);

  switch (state_) {
    case State::kIdle:
      if (mag > threshold) {
        peak_mv_ = conditioned_mv;
        // Stash the bar this deflection was actually judged against; sigma
        // moves before the rebound confirms, several samples later.
        threshold_mv_ = threshold;
        state_ = State::kDeflecting;
      }
      break;

    case State::kDeflecting:
      if (mag >= std::fabs(peak_mv_)) {
        peak_mv_ = conditioned_mv;
      } else {
        state_ = State::kRebounding;
      }
      break;

    case State::kRebounding: {
      if (mag >= std::fabs(peak_mv_)) {
        // Still moving the same direction (or a new larger deflection) --
        // keep tracking the extremum rather than falsely calling it a rebound.
        peak_mv_ = conditioned_mv;
        state_ = State::kDeflecting;
        break;
      }
      const float rebound_ratio = (std::fabs(peak_mv_) - mag) / std::fabs(peak_mv_);
      if (rebound_ratio >= 0.30f) {
        // Publish before clearing -- peak_mv_ is the only record of what fired,
        // and the line below destroys it.
        last_peak_mv_ = peak_mv_;
        last_threshold_mv_ = threshold_mv_;
        state_ = State::kIdle;
        peak_mv_ = 0.0f;
        return true;
      }
      break;
    }
  }

  return false;
}
