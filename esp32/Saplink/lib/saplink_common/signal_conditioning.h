#pragma once

// Median filter + adaptive baseline. No 60Hz notch stage: the actual sample
// rate is 10Hz (100ms period, see combo_main.cpp), so Nyquist is 5Hz and a
// 60Hz notch would only alias, never filter -- not viable at this rate.
// Revisit only if the sample rate is raised well above 120Hz.
class SignalConditioner {
 public:
  float update(float raw_mv);
  float baseline() const { return baseline_; }

 private:
  static constexpr int kMedianWindow = 5;
  float median_buf_[kMedianWindow] = {0};
  int median_count_ = 0;
  int median_next_ = 0;

  float baseline_ = 0.0f;
  float alpha_ = 0.01f;

  float median() const;
};
