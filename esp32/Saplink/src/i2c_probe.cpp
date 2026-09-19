#include <Arduino.h>
#include <Wire.h>

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

static void capacitanceProbe() {
  // 18/19/23 are non-RTC like 21/22 and assumed bare: the "nothing attached"
  // baseline. Jumpers plus a module add capacitance and slow the rise.
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
  // ~98-cycle bare floor is a pin with a wire actually in it.
  const uint8_t pins[] = {4,  5,  12, 13, 14, 15, 16, 17, 18,
                          19, 21, 22, 23, 25, 26, 27, 32, 33};
  Serial.print("loaded pins:");
  bool any = false;
  for (uint8_t p : pins) {
    uint32_t c = riseCycles(p);
    if (c > 120) {
      Serial.printf(" GPIO%u=%lu", p, c);
      any = true;
    }
  }
  if (!any) Serial.print(" none");
  Serial.println("   (GPIO2 LED reads ~161 for scale)");
}

static int scan(int sda, int scl, uint32_t hz) {
  Wire.end();
  Wire.begin(sda, scl, hz);
  delay(50);
  int found = 0;
  Serial.printf("scan SDA=%d SCL=%d @%luHz: ", sda, scl, hz);
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    uint8_t err = Wire.endTransmission();
    if (err == 0) {
      Serial.printf("ACK 0x%02X ", addr);
      found++;
    } else if (err != 2 && err != 3) {
      Serial.printf("0x%02X err=%u ", addr, err);  // 4/5 = bus stuck low
    }
  }
  Serial.printf("-> %d device(s)\n", found);
  return found;
}

void setup() {
  Serial.begin(115200);
  delay(300);
}

void loop() {
  Serial.printf("\nSDA(21) pull-up=%d  SCL(22) pull-up=%d\n",
                pulledUpExternally(SDA_PIN), pulledUpExternally(SCL_PIN));
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
