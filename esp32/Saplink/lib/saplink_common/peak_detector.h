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

 private:
  enum class State { kIdle, kDeflecting, kRebounding };

  State state_ = State::kIdle;
  float peak_mv_ = 0.0f;
};
