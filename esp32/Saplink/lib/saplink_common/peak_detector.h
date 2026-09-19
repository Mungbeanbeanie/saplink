#pragma once

// Classifies a conditioned deflection as a real Action Potential using
// PlantLeaf/TommyVaninetti's criteria: initial deflection exceeds 3sigma of
// the rolling baseline noise floor, and the rebound back toward baseline
// reaches >=30% of that initial deflection (rejects one-way drift/noise that
// never rebounds). No dependency on signal_conditioning.h -- caller passes
// the already-conditioned value in.
class PeakDetector {
 public:
  bool check(float conditioned_mv, float baseline_sigma);

  // The deflection that actually satisfied the criteria, and the bar it was
  // measured against. Valid only right after check() returns true.
  //
  // These exist because a deflection is tracked ACROSS batches: it can start in
  // one 32-sample batch and have its rebound confirmed in the next. A caller
  // scanning only the current batch for its own maximum therefore misses the
  // real peak whenever a VP straddles the boundary, and reports a voltage lower
  // than the threshold it supposedly cleared. Ask the detector instead.
  float lastPeak() const { return last_peak_mv_; }
  float lastThreshold() const { return last_threshold_mv_; }

 private:
  enum class State { kIdle, kDeflecting, kRebounding };

  State state_ = State::kIdle;
  float peak_mv_ = 0.0f;
  // Captured when the deflection is latched, not when the rebound confirms --
  // sigma drifts between those two samples, so reporting the later value would
  // pair the peak with a bar it was never actually compared against.
  float threshold_mv_ = 0.0f;

  float last_peak_mv_ = 0.0f;
  float last_threshold_mv_ = 0.0f;
};
