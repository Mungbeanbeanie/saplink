#pragma once

#include <cstdint>

// Median filter + adaptive baseline. No 60Hz notch stage: the actual sample
// rate is 10Hz (100ms period, see combo_main.cpp), so Nyquist is 5Hz and a
// 60Hz notch would only alias, never filter -- not viable at this rate.
// Revisit only if the sample rate is raised well above 120Hz.
class SignalConditioner {
 public:
  float update(float raw_mv);
  float baseline() const { return baseline_; }
  float sigma() const;


  // What the frontend plots. The electrode carries a tens-of-mV standing
  // offset that wanders for minutes as it polarizes (measured: 95mV -> 19mV ->
  // 30mV on one insertion), so absolute mV cannot be drawn on a fixed axis.
  // The deviation can: it sits at zero and only the signal moves it.
  float deviation() const { return filtered_ - baseline_; }

  // Rolling noise floor for PeakDetector's 3-sigma threshold. Nothing computed
  // this before -- the caller passed a hardcoded 1.0f, which against a measured
  // 0.1mV noise floor sets the bar ~30x too high to ever fire.
  float sigma() const { return sigma_; }

  // Whether sigma has seen enough data to mean anything. Detection must stay
  // off until then: an under-estimated sigma does not merely mis-fire, it fires
  // on every sample, so the honest state beforehand is "don't know" rather than
  // "spike". 100 samples is 10s at the 10Hz sample rate.
  bool warm() const { return samples_ > kWarmupSamples; }

 private:
  static constexpr int kMedianWindow = 5;
  float median_buf_[kMedianWindow] = {0};
  int median_count_ = 0;
  int median_next_ = 0;

  float baseline_ = 0.0f;
  // Seeded nonzero (not 0) so PeakDetector's 3*sigma threshold isn't ~0 on
  // the first samples, before the EMA below has had time to converge.
  float variance_ = 1.0f;
  float alpha_ = 0.01f;

  bool seeded_ = false;
  float filtered_ = 0.0f;

  // Mean absolute deviation, tracked far slower than the baseline (tau ~100s at
  // 10Hz vs ~10s) so that a spike cannot inflate the very threshold it must
  // clear and hide itself.
  static constexpr float kSigmaAlpha = 0.001f;
  float mad_ = 0.0f;

  static constexpr uint32_t kWarmupSamples = 100;
  uint32_t samples_ = 0;

  // A settled electrode goes quieter than the ADC can resolve, and an unfloored
  // sigma then trends toward zero -- making 3*sigma fire on every sample. One
  // ADS1115 LSB at GAIN_FOUR (31uV) is the smallest real difference the
  // hardware can see, so noise is never honestly below it.
  static constexpr float kSigmaFloorMv = 0.031f;
  float sigma_ = kSigmaFloorMv;

  float median() const;
};
