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
        held_ = 1;
        rebound_held_ = 0;
        state_ = State::kDeflecting;
      }
      break;

    case State::kDeflecting:
      // Fell back into the noise band before it ever held. That is a blip --
      // one aliased mains cycle, one ADC outlier -- not the onset of anything.
      // Compared against threshold_mv_, the bar latched with this deflection,
      // so a sigma that drifts mid-deflection cannot silently move the exit.
      if (mag <= threshold_mv_) {
        reset();
        break;
      }
      held_++;
      if (mag >= std::fabs(peak_mv_)) {
        peak_mv_ = conditioned_mv;
      } else if (held_ >= kSustainSamples) {
        // Only a deflection that has held long enough is allowed to rebound.
        // Without this the very first non-extremum sample opens the rebound
        // test, which the ~3-sample hum satisfies immediately.
        state_ = State::kRebounding;
      }
      break;

    case State::kRebounding: {
      if (mag >= std::fabs(peak_mv_)) {
        // Still moving the same direction (or a new larger deflection) --
        // keep tracking the extremum rather than falsely calling it a rebound.
        peak_mv_ = conditioned_mv;
        rebound_held_ = 0;
        state_ = State::kDeflecting;
        break;
      }
      const float rebound_ratio = (std::fabs(peak_mv_) - mag) / std::fabs(peak_mv_);
      // Consecutive, not cumulative: the recovery has to persist. A drift that
      // only dips past 30% on alternate samples is hum riding a one-way slide,
      // and resetting here is what tells the two apart.
      rebound_held_ = rebound_ratio >= 0.30f ? rebound_held_ + 1 : 0;
      if (rebound_held_ >= kSustainSamples) {
        if (std::fabs(peak_mv_) < kMinAmplitudeMv) {
          // Right shape, no substance. Drop it rather than dose a plant over a
          // sub-millivolt wobble that only cleared a threshold derived from
          // that same wobble.
          reset();
          break;
        }
        // Publish before clearing -- peak_mv_ is the only record of what fired,
        // and reset() below destroys it.
        last_peak_mv_ = peak_mv_;
        last_threshold_mv_ = threshold_mv_;
        reset();
        return true;
      }
      break;
    }
  }

  return false;
}
