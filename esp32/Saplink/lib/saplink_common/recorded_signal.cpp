#include "recorded_signal.h"

#ifdef ARDUINO
#include <pgmspace.h>
#else
// env:native has no Arduino framework -- PROGMEM/pgm_read_float are no-ops
// there since there's no flash/RAM split to care about.
#define PROGMEM
#define pgm_read_float(addr) (*(addr))
#endif

const float RECORDED_VP_WAVEFORM[] PROGMEM = {
    -0.0f,   -9.838f, -17.804f, -24.165f, -29.154f, -32.974f, -35.804f,
    -37.796f, -39.085f, -39.786f, -40.0f,  -39.813f, -39.299f, -38.523f,
    -37.538f, -36.392f, -35.124f, -33.768f, -32.352f, -30.899f, -29.43f,
    -27.961f, -26.505f, -25.073f, -23.673f, -22.313f, -20.997f, -19.73f,
    -18.513f, -17.35f,  -16.24f,  -15.185f, -14.183f, -13.234f, -12.338f,
    -11.492f, -10.695f, -9.946f,  -9.243f,  -8.584f,  -7.966f,  -7.388f,
    -6.848f,  -6.344f,  -5.874f,  -5.436f,  -5.028f,  -4.648f,  -4.295f,
    -3.967f,  -3.663f,  -3.381f,  -3.119f,  -2.877f,  -2.652f,  -2.444f,
    -2.252f,  -2.074f,  -1.909f,  -1.757f,
};

const size_t RECORDED_VP_WAVEFORM_LEN =
    sizeof(RECORDED_VP_WAVEFORM) / sizeof(RECORDED_VP_WAVEFORM[0]);

void RecordedSignalPlayer::trigger() {
  index_ = 0;
  armed_ = true;
}

bool RecordedSignalPlayer::nextSample(float &out_mv) {
  if (armed_ && index_ < RECORDED_VP_WAVEFORM_LEN) {
    out_mv = pgm_read_float(&RECORDED_VP_WAVEFORM[index_++]);
    return true;
  }
  armed_ = false;
  return false;
}
