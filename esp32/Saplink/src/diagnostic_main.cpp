#include <Arduino.h>
#include <Wire.h>
#include <driver/gpio.h>

// ponytail: I2C bus check. GPIO21 = SDA, GPIO22 = SCL (esp32dev defaults).
#define SDA_PIN 21
#define SCL_PIN 22

// A floating ESP32 input holds the charge from whatever last drove it, so a
// plain read reports phantom HIGHs. Drive the pin LOW, release it, then read:
// only a real external pull-up can bring it back up.
static bool pulledUpExternally(uint8_t pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delayMicroseconds(100);
  pinMode(pin, INPUT);
  delayMicroseconds(50);
  return digitalRead(pin);
}

// Rise time under the internal pull-up, in CPU cycles (240MHz -> ~4ns each).
// A bare pin has only its own few pF and snaps up; jumpers plus a module's
// input capacitance measurably slow it. Comparing a suspect pin against a
// known-empty one says whether anything is physically attached.
static uint32_t riseCycles(uint8_t pin) {
  const bool hi = pin >= 32;  // pins 32+ live in the second register bank
  const uint32_t mask = 1UL << (hi ? pin - 32 : pin);
  pinMode(pin, INPUT_PULLUP);  // pull-up stays set in the IO mux below
  uint32_t total = 0;
  const int trials = 32;
  for (int i = 0; i < trials; i++) {
    if (hi) {
      GPIO.out1_w1tc.val = mask;     // drive low...
      GPIO.enable1_w1ts.val = mask;  // ...by enabling the output driver
    } else {
      GPIO.out_w1tc = mask;
      GPIO.enable_w1ts = mask;
    }
    delayMicroseconds(200);
    noInterrupts();
    uint32_t t0 = ESP.getCycleCount();
    // release in a single write; the pull-up takes over from here
    if (hi) GPIO.enable1_w1tc.val = mask;
    else GPIO.enable_w1tc = mask;
    while (ESP.getCycleCount() - t0 < 240000) {
      if ((hi ? GPIO.in1.val : GPIO.in) & mask) break;
    }
    total += ESP.getCycleCount() - t0;
    interrupts();
  }
  return total / trials;
}

// 18/19/23 are non-RTC like 21/22 and assumed bare: the "nothing attached"
// baseline. Jumpers plus a module add capacitance and slow the rise.
static const uint8_t BARE_REF[] = {18, 19, 23};

// Measured every sweep, never hardcoded. The previous fixed threshold of 120
// was written against a ~98-cycle floor; this board idles at ~129, which
// silently promoted every pin on the header to "loaded".
static_assert(sizeof(BARE_REF) == 3, "bareFloor() takes a median of exactly 3");

static uint32_t bareFloor() {
  const uint32_t a = riseCycles(BARE_REF[0]), b = riseCycles(BARE_REF[1]),
                 c = riseCycles(BARE_REF[2]);
  // Median, not min or mean. Each of the other two fails a real case seen on
  // this board: a reference pin that quietly has something attached reads high
  // and drags a mean up, hiding real loads; GPIO18 reads ~108 instead of ~129
  // for the first few seconds after reset, and min() followed it down and
  // flagged every pin on the header. The middle value ignores one bad ref in
  // either direction.
  const uint32_t lo = min(min(a, b), c), hi = max(max(a, b), c);
  return a + b + c - lo - hi;
}

// ponytail: 15% over the measured floor. Observed spread on this board is bare
// 129, suspected-load GPIO21 159, known-loaded GPIO2 189 -- so 1.15x clears the
// 129/130 jitter and still catches 159. This is the calibration knob: widen it
// if bare pins start reporting loaded, narrow it if a known load is missed.
static const uint32_t kLoadedPercent = 115;

static void capacitanceProbe() {
  // GPIO2 drives the onboard LED, so it is a known-loaded positive control:
  // if it does not read slower than the bare pins, this probe proves nothing.
  const uint8_t pins[] = {SDA_PIN, SCL_PIN, 18, 19, 23, 2};
  Serial.print("rise cycles:");
  for (uint8_t p : pins) Serial.printf("  GPIO%u=%lu", p, riseCycles(p));
  Serial.println("   (18/19/23 = bare, GPIO2 = loaded control)");
}

static void sweep() {
  // output-capable pins only; 34-39 are input-only and cannot be driven low.
  // Anything attached adds capacitance, so a pin reading well above the
  // measured bare floor is a pin with a wire actually in it.
  const uint8_t pins[] = {4,  5,  12, 13, 14, 15, 16, 17, 18,
                          19, 21, 22, 23, 25, 26, 27, 32, 33};
  const uint32_t floor_c = bareFloor();
  const uint32_t threshold = floor_c * kLoadedPercent / 100;

  Serial.printf("floor=%lu threshold=%lu (median of GPIO%u/%u/%u, +%lu%%)\n",
                floor_c, threshold, BARE_REF[0], BARE_REF[1], BARE_REF[2],
                kLoadedPercent - 100);

  Serial.print("loaded pins:");
  bool any = false;
  for (uint8_t p : pins) {
    uint32_t c = riseCycles(p);
    if (c > threshold) {
      Serial.printf(" GPIO%u=%lu", p, c);
      any = true;
    }
  }
  if (!any) Serial.print(" none");
  Serial.println();
}

// Both jumpers pushed into the same breadboard row is silent to everything else
// here: each pin still measures "loaded" because a wire really is in it, and the
// bus still NACKs cleanly. Drive one pin low and watch whether the other follows.
static bool shortedTogether(uint8_t a, uint8_t b) {
  pinMode(b, INPUT_PULLUP);
  pinMode(a, OUTPUT);
  digitalWrite(a, LOW);
  delayMicroseconds(200);
  const bool follows = (digitalRead(b) == LOW);
  pinMode(a, INPUT);
  return follows;
}

static int scan(int sda, int scl, uint32_t hz) {
  Wire.end();
  // begin() returns false if the peripheral never came up. Unchecked, that
  // failure is indistinguishable from "bus fine, nobody home" -- the exact
  // ambiguity this whole sketch exists to remove.
  const bool began = Wire.begin(sda, scl, hz);
  // Recent ESP32 Arduino cores leave the internal pull-ups OFF in Wire.begin().
  // If the breakout has none of its own either, the bus has no pull-ups at all:
  // the lines can never rise, nothing can ACK, and it reads identically to "no
  // device present". gpio_set_pull_mode and not pinMode -- pinMode would detach
  // the I2C peripheral from the pin through the GPIO matrix. ~45k is weak, which
  // is why the 10kHz scans exist.
  gpio_set_pull_mode((gpio_num_t)sda, GPIO_PULLUP_ONLY);
  gpio_set_pull_mode((gpio_num_t)scl, GPIO_PULLUP_ONLY);
  delay(50);
  int found = 0;
  // Idle levels with the pull-ups on. 1/1 is a healthy bus. A 0 means that line
  // is held down -- a short to ground, or a device stuck mid-transaction.
  Serial.printf("scan SDA=%d SCL=%d @%luHz: begin=%d idle(sda=%d,scl=%d) ", sda,
                scl, hz, began, digitalRead(sda), digitalRead(scl));
  // A line stuck low can't be clocked, and endTransmission() then burns its full
  // timeout on all 126 addresses -- the scan looks hung rather than failed. The
  // idle levels already say everything a scan would, so report and bail.
  if (!digitalRead(sda) || !digitalRead(scl)) {
    Serial.printf("LINE STUCK LOW (%s%s) -- shorted to GND, check for a solder "
                  "bridge; skipping scan\n",
                  digitalRead(sda) ? "" : "SDA ", digitalRead(scl) ? "" : "SCL");
    return 0;
  }
  uint16_t errs[8] = {0};
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    uint8_t err = Wire.endTransmission();
    if (err == 0) {
      Serial.printf("ACK 0x%02X ", addr);
      found++;
    }
    errs[err < 8 ? err : 7]++;
  }
  // The error spread is the real diagnostic, so print it rather than hiding the
  // common codes. err=2 is a CLEAN NACK: the master clocked out the address,
  // released SDA, and read it high. 126 of those means the master and the bus
  // are both working and nothing answered. err=4/5 would mean transactions
  // never completed at all -- that is a bus fault, a different problem.
  Serial.print("errs");
  for (int i = 0; i < 8; i++)
    if (errs[i]) Serial.printf(" %d:%u", i, errs[i]);
  Serial.printf(" -> %d device(s)\n", found);
  return found;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  // COLD scan, before sweep() and capacitanceProbe() have ever touched 21/22.
  // Those drive the pins hard through raw GPIO registers, and if the bus only
  // fails on the warm scans that follow, the probing is the culprit rather than
  // the wiring. Same call, clean pin state -- that is the whole point.
  Serial.println("\n--- cold scan, pins untouched since boot ---");
  scan(SDA_PIN, SCL_PIN, 10000);
}

void loop() {
  const bool sda_up = pulledUpExternally(SDA_PIN),
             scl_up = pulledUpExternally(SCL_PIN);
  Serial.printf("\nSDA(21) pull-up=%d  SCL(22) pull-up=%d  21-22 shorted=%d\n",
                sda_up, scl_up, shortedTogether(SDA_PIN, SCL_PIN));
  // The breakout's own pull-up is the only thing at the far end of these wires
  // that can pull a released pin high, so seeing it IS the continuity test --
  // and it names the bad line, which beeping a multimeter into a breadboard row
  // does not. Printed as a verdict so wires can be reseated while watching this.
  if (sda_up && scl_up) Serial.println("WIRING OK -- both lines reach the module");
  else Serial.printf("CHECK WIRE: %s%s not reaching the module\n",
                     sda_up ? "" : "SDA(21) ", scl_up ? "" : "SCL(22)");
  sweep();
  capacitanceProbe();
  scan(SDA_PIN, SCL_PIN, 100000);
  // 10kHz: the ESP32's internal ~45k pull-ups are marginal at 100kHz if the
  // board's own 10k pull-ups are missing, as this one's appear to be.
  scan(SDA_PIN, SCL_PIN, 10000);
  scan(SCL_PIN, SDA_PIN, 10000);  // swapped, in case the jumpers are crossed
  Serial.println("ADS1115 expected at 0x48 (ADDR->GND), 0x49 (VDD), "
                 "0x4A (SDA), 0x4B (SCL)");
  delay(3000);
}
