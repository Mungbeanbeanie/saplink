#pragma once

#include <cstddef>

// SYNTHETIC placeholder, not a real recording (see plan.md's Phase 2
// divergence note). Real reference data (BackyardBrains Plant-SpikerBox /
// ETigerschuss's conduction-velocity-plants) is hosted on FigShare, gitignored
// out of that repo, and no direct download link was found in this pass.
//
// Shape is an alpha-function pulse v(t) = -40 * (t/tau) * exp(1 - t/tau),
// tau=1.0s, t=0..5.9s at 100ms steps (60 samples) -- matching
// combo_main.cpp's 10Hz sample rate. Timescale/amplitude are only loosely
// informed by conduction-velocity-plants' manifest.csv (VP durations ~1-10s)
// and BackyardBrains' documented VP amplitude range, not fit to any specific
// real recording. Revisit: swap this array for a real recorded waveform once
// the FigShare dataset is located.
extern const float RECORDED_VP_WAVEFORM[];
extern const size_t RECORDED_VP_WAVEFORM_LEN;

class RecordedSignalPlayer {
 public:
  void trigger();
  bool nextSample(float &out_mv);

 private:
  bool armed_ = false;
  size_t index_ = 0;
};
