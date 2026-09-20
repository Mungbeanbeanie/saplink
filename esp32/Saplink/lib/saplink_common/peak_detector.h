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
  enum class State { kIdle, kDeflecting, kRebounding, kTooLong };

  // A bare 3sigma-and-30%-rebound test fires on noise every few minutes by
  // construction, and that is exactly what hardware did: 11 alerts in 21
  // minutes, every one of them with a peak 1.01-1.3x its own threshold. Worse,
  // the dominant interference was 60Hz mains aliased down to a ~3-sample period
  // (lag-3 autocorrelation 0.64-0.97 on every quiet batch), which IS a
  // deflect-then-rebound pattern three times a second. These two gates are what
  // separate a VP from that.
  //
  // Duration: overview.md puts a real VP at tens of seconds to minutes, so a
  // deflection that does not hold is not one. 15 samples is ~1.5s at 10Hz --
  // long against the aliased hum, short against a VP. Used for BOTH phases: the
  // rebound has to be sustained too, because a single hum dip inside a
  // monotonic drift satisfies the 30% ratio instantly (measured on batches
  // 746-748, a one-way slide to -4.3mV that never recovered).
  //
  // ponytail: class-level, so BOTH plants share this bar and kMinAmplitudeMv
  // below (as they share SignalConditioner's kSigmaFloorMv). Fine while the
  // two electrodes sit in comparable soil with comparable sigma -- plant 1
  // measured ~0.5mV. If plant 2 turns out to need a different bar it will
  // either never fire or fire constantly, and there is no knob short of
  // editing this header. Upgrade then: make these instance fields set from
  // combo_main.cpp's Plant, chosen from measured sigma on BOTH channels,
  // never from one.
  static constexpr int kSustainSamples = 15;
  // Upper bound on the WHOLE excursion -- deflection plus rebound -- in
  // samples. kSustainSamples says a real event must last; this says it must
  // also END, and it is the only gate that separates the two demo stimuli.
  //
  // Measured on this rig, 3 leaf-rips vs 3 branch-fiddles on sense-1, replayed
  // through this class: amplitude cannot separate them and ranks them
  // BACKWARDS -- the worst fiddle peaked 55.8mV against rips of 23.3/39.8/
  // 41.6mV. Duration does, because the two are different KINDS of thing. A
  // tear is an impulse: tissue ruptures, the transient propagates, and the
  // electrode is back under its bar inside ~2.5s (25-37 samples). Handling is
  // a state: the electrode stays mechanically displaced and body-coupled for
  // as long as a hand is on the plant, ~6-10s (62-96 samples). An excursion
  // that outlasts this is a hand, not a wound, so kTooLong drops it.
  //
  // 50 sits mid-window: rips were still firing at 43, and the boot-time
  // handling artifact (66.4mV, the one that doses on reset) got back in at 58.
  // Samples, not seconds -- like kSustainSamples this counts check() calls and
  // never looks at a clock, so an excursion straddling the ~3.6s inter-batch
  // gap covers more wall time than the 5.0s that 50 samples suggests.
  static constexpr int kMaxExcursionSamples = 50;
  // Absolute floor, in millivolts. 3sigma is self-referential -- it fires
  // whenever noise briefly exceeds its own running estimate, so on this rig it
  // was arming the pump on 0.447mV "events". Measured electrode sigma is
  // ~0.5mV. Calibration knob: lower it once the electrode noise floor drops.
  //
  // Raised 2.0 -> 10.0 from the rip/fiddle capture. 2.0 was set against one
  // quiet electrode; sense-2 then fired three times on 2.99-6.49mV wobbles,
  // one of them while the OTHER plant was being handled, and dosed the plant
  // nobody was touching. 10.0 clears every non-event deflection measured on
  // either channel and still sits 2.3x under the smallest real rip (23.3mV).
  // It does NOT reject the fiddles -- they are the largest events in the set;
  // kMaxExcursionSamples does that.
  static constexpr float kMinAmplitudeMv = 10.0f;

  State state_ = State::kIdle;
  float peak_mv_ = 0.0f;
  // Samples the deflection has held above threshold_mv_, and samples the
  // rebound has held past the 30% ratio. Both reset on every return to kIdle.
  int held_ = 0;
  int rebound_held_ = 0;
  // Samples since the deflection was first latched, counted across BOTH
  // phases. held_ cannot do this job: it stops advancing the moment the state
  // machine leaves kDeflecting, so a long handling artifact that spends most
  // of its life in kRebounding never accumulates one.
  int since_onset_ = 0;
  // Captured when the deflection is latched, not when the rebound confirms --
  // sigma drifts between those two samples, so reporting the later value would
  // pair the peak with a bar it was never actually compared against.
  float threshold_mv_ = 0.0f;

  float last_peak_mv_ = 0.0f;
  float last_threshold_mv_ = 0.0f;

  // Every path back to kIdle goes through here. There are four of them now
  // (abort, under-amplitude, fire, and a new extremum re-arming) and forgetting
  // one counter on one of them leaves a stale hold count that shortens the next
  // deflection's gate.
  void reset() {
    state_ = State::kIdle;
    peak_mv_ = 0.0f;
    held_ = 0;
    rebound_held_ = 0;
    since_onset_ = 0;
  }
};
