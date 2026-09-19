## Purpose

Old-growth "mother trees" act as hubs in a forest's mycorrhizal (fungal) network — sensing stress in nearby trees/seedlings and routing water, nutrients, and defense signals to support them. Deforestation and intensive logging remove these hub trees, cutting seedlings off from that support network.

This project is a synthetic stand-in for that lost relay function: an electronic system that senses stress in one plant and routes a support response to another. The primary proof-of-concept demonstrates that sense→route→actuate mechanism on a single plant — reading it, then triggering its own support response from an artificial "alert" signal standing in for a second plant's stress — since a full two-plant setup needs hardware not yet in hand. The two-plant version, one plant's real stress signal routed to support a separate plant, is the target vision once that hardware exists.

## System Overview

A two-plant bioelectric relay — Plant A's stress signal sensed, classified, and posted over WiFi to a Vultr-hosted cloud backend, which stores it and instructs Plant B's actuator node to prime defenses and provide synthetic resource support — is the target vision, restoring the biological data and resource plane across deforested clear-cuts where old-growth "mother tree" nodes have been severed. The primary build target is narrower: one ESP32 running combined sense+actuate firmware and one plant, with an artificial alert signal substituting for a second plant's live stress event, proving the full sense→cloud→actuate loop before a second physical plant/board set exists. The cloud backend is the hub either way — it's what lets the sensor and actuator roles run independently (or even on the same board) without needing to be powered on together or in radio range, which is what makes the single-board primary demo possible at all.

## End-to-End System Architecture

**Primary Demo Architecture (Single Plant, Combo Board):**

```
Plant A ──► ┌───────────────────────────────┐   WiFi/HTTPS POST   ┌──────────────────────┐
 • Chlorided │ combo_main.cpp                │──────────────────► │ Vultr API + Postgres │
   Ag Wire   │ (ESP32 + ADS1115)              │  "ALERT: VP Spike   │ (Dockerized)         │
   Probes    │ • Sense: signal_conditioning,  │   (live or          └──────────┬───────────┘
             │   peak_detector                │    artificial)"                │ WiFi/HTTPS GET (self-poll)
             │ • Or: RecordedSignalPlayer      │                                ▼
             │   injects an artificial alert  │◄───────────────────────────────┘
             │ • Actuate: same board polls its│   "PENDING: fire relay"
             │   own posted alert, fires relay│
             │   /pump + LED/buzzer           │
             └───────────────┬────────────────┘
                              │ actuation dose (relay/pump/LED co-located with the probes)
                              ▼
                          Plant A (same plant, receives its own routed response)
```

**Target Architecture (Two-Plant, Stretch Goal):**

```
                    [ CONTROL ZONE ]
                 Control Plant Baseline
                          │
                          ▼
                ┌───────────────────┐
                │ Reference Probes  │
                └─────────┬─────────┘
                          │
                          ▼
[ ORIGIN ZONE ]      [ SENSE ]                                     [ CLOUD HUB — Vultr, Dockerized ]                                    [ ACTUATE ]
Plant A (Origin) ──► ┌───────────────────────────┐   WiFi/HTTPS POST    ┌────────────────────────────────┐   WiFi/HTTPS GET (poll)    ┌───────────────────────────┐ ──► Primary: Peristaltic Pump
  • Stressed         │ Sensing Node              │   "ALERT: VP Spike"  │ REST API + Postgres            │   "PENDING: fire relay"   │ Actuator Node             │     • Defense Priming Proxy
  • Chlorided Ag Wire│ • ESP32 + ADS1115         │ ────────────────────►│ (readings, alerts, ack state)  │ ──────────────────────────►│ • ESP32 + 5V Relay        │     • Resource Lifeline (N-P-K)
   Probes in Stem/Soil│ • Median/Notch + Auto-Zero│                      └────────────────┬───────────────┘                             └─────────────┬─────────────┘ ──► Fallback: LED & Buzzer
                     └─────────────┬─────────────┘                                        │ WiFi/HTTPS GET                                            │                   • Visual "Primed" State
                                   │                                                        ▼                                                          ▲
                     ┌───────────────────────────┐                            ┌───────────────────────────┐                                           │
                     │ Recorded Signal Fallback  │ ── local pipeline ────────►│ Frontend Dashboard        │                                            │
                     │ (Pre-recorded VP Replay)  │   also: manual "inject     │ (React, standalone)      │────────────────────────────────────────────┘
                     │                           │    alert" POST ────────────►│ pulls readings + can post │  (manual replay trigger reaches the actuator
                     └───────────────────────────┘                            │ a replay trigger          │   the same way a live alert would)
                                                                               └───────────────────────────┘
```

**Demo Timing Note:** Real bioelectric responses propagate over tens of seconds to minutes. The live demonstration narrates through this latency window rather than expecting instant plant physics — the added WiFi/HTTP round-trip to the cloud is well under a second and isn't a limiting factor next to that. A pre-recorded signal replay path (local, or a manual POST straight to the cloud API) acts as an instant fallback if the live plant remains dormant on stage.

## Detailed Subsystem Breakdown

**Primary vs. stretch:** On the primary single-board build, Sense and Actuate below both run inside `combo_main.cpp` on one plant. The separate Sensing Node / Actuator Node split described in each subsystem is the two-plant stretch goal.

### 1. Sense Subsystem (Inbound Data)
- **Probe Interface:** 18-gauge fine silver wire electrodes, chlorided via brief electrolysis or a diluted-bleach dip to minimize noise relative to raw silver. Two probe pairs: one in the stem base/tissue, one in rhizosphere soil.
- **Reference Placement:** Includes a third control-plant reference probe pair operating simultaneously to demonstrate that signal triggers are distinct from ambient electrical or thermal noise.
- **Signal Capture:** ADS1115 16-bit differential ADC reading 0.1–100 mV Variation Potentials (VPs) and Action Potentials (APs).
- **Signal Conditioning:** Digital median filter and 60 Hz notch filter on the ESP32 to eliminate AC mains hum, paired with a rolling baseline/auto-zero algorithm. Auto-zeroing dynamically tracks natural, multi-minute voltage drifts to prevent false triggers or missed thresholds.
- **Cloud Uplink:** Sensing Node joins the local WiFi network (SSID/credentials provisioned at flash time) and posts each qualifying alert as an HTTPS POST directly to the Vultr-hosted API — no ESP-NOW/LoRa pairing required.

### 2. Route Subsystem (Cloud Data Plane)
- **Edge Classifier:** Peak-detection algorithm running on the sensing ESP32, firing a digital alert state when a rapid delta (ΔV > threshold) is detected post-auto-zeroing.
- **Cloud Backend:** A Vultr VPS running a Dockerized stack — REST API (Python) + Postgres — receives sensor POSTs, persists alert/reading history, and exposes pending-actuation state for the actuator to poll. Docker Compose (API container + Postgres container) keeps the stack reproducible if the droplet is ever rebuilt.
- **Actuator Poll:** (primary) The same combo board polls the API for its own just-posted alert and actuates on the same plant. (stretch) A separate Actuator Node polls instead, for a different plant. Either way: on receiving a pending, unacknowledged alert, proceed to Actuate, then POST an acknowledgment so the same alert can't fire twice.
- **Interface Schema:** The field layout (node_id, event_type, voltage_mv, threshold_mv, timestamp_ms) is the REST payload schema — locked between sensor firmware, backend API, and frontend before all three are built independently.

### 3. Actuate Subsystem (Outbound Response)
- **Trigger Mechanics:** (primary) The same ESP32 that posted the alert polls the cloud API and actuates onto the same plant. (stretch) A separate Actuator ESP32 does this for Plant B. Either way: on finding a pending alert, energize a 5V relay module driving a 5V micro peristaltic pump, then POST an ack back.
- **Defense Priming Proxy:** Dispenses a micro-dose of signaling proxy (saline or defense-priming compounds) directly into Plant B's root zone to trigger metabolic reallocation (root fortification and stomatal response).
- **Resource Lifeline:** Option to deliver liquid N-P-K nutrients or hydration, mimicking the missing carbon, nitrogen, and water flux historically provided by mycorrhizal fungal networks.
- **Reliability Fallback:** A dedicated LED/buzzer array wired in parallel with the relay trigger to provide an immediate visual/audible "Target Network Node Primed" signal if the pump experiences mechanical binding or air lock.
- **Manual Replay Path:** The frontend's replay-trigger control can POST directly to the cloud API's alert endpoint, giving the actuator an identical pending alert to consume — a real trigger, not display-only, since the actuator only ever cares about what the API says is pending.

## Complete Bill of Materials (BOM)

| Component | Qty | Primary Function | Sourcing / Check |
|---|---|---|---|
| ESP32 Microcontrollers | 1 (primary) / 2 (stretch: separate sensor + actuator boards) | Combo board (primary), or Sensing Node (Node 1) & Actuating Node (Node 2) (stretch) | Micro Center / Amazon Overnight |
| ADS1115 16-Bit ADC | 1 | Precision differential voltage measurement | Micro Center / Adafruit |
| 18-Gauge Fine Silver Wire | 1 pair (primary: Plant A only) / 3 pairs (stretch: +Plant B, +Control) | Chlorided electrodes (Plant A, Plant B, Control) | Craft/Jewelry store or Amazon |
| 5V Relay Module | 1 | High-current switch for pump/actuator execution | Micro Center / Amazon |
| 5V Micro Peristaltic Pump | 1 | Precision fluid dispensing onto target plant | Amazon Overnight |
| LED + Buzzer Module | 1 | Primary fallback indicator for network actuation | Micro Center / Hardware bin |
| Potted Houseplants | 1 (primary) / 3 (stretch: +Plant B, +Control) | Plant A (Origin), Plant B (Target), Plant C (Control) | Local Grocery / Home Depot |
| Digital Multimeter | 1 | Line checking, impedance, and voltage sanity tests | Micro Center / Field Gear |
| Data-Capable USB Cables | 2 | ESP32 flashing and serial streaming (verified data pins) | Micro Center / Field Gear |

## The Hackathon Demo Workflow

Steps below describe the primary single-plant/combo-board demo. Where two-plant hardware exists, Actuation (step 4) happens on a separate actuator board/Plant B instead of looping back to Plant A.

1. **Baseline Verification:** Show Plant A's live baseline voltage stream on the React dashboard (reading directly from the Vultr-hosted API), demonstrating the auto-zeroing and 60 Hz noise rejection. (stretch: also show Plant B and the Control Plant.)
2. **Stress Application:** Apply a real localized stimulus (leaf pinch, cold shock, or saline dip) to Plant A, or arm `RecordedSignalPlayer`'s trigger to inject an artificial alert — either path feeds the same pipeline.
3. **Signal Capture & Routing:** The ADS1115 records the 0.1–100 mV VP spike. The sensing ESP32 executes peak detection and POSTs the alert to the Vultr API over WiFi.
4. **Actuation & Resource Provision:** (primary) The same combo board's next poll picks up its own pending alert, energizes the relay, and the peristaltic pump delivers the nutrient/defense proxy back onto Plant A while the LED/buzzer confirms the "Target Network Node Primed" state; it POSTs an ack back to the API. (stretch) A separate actuator board does this for Plant B instead.
5. **Fallback Safety Net:** If the live plant stays dormant, trigger the pre-recorded VP replay — either locally on the sensor node, or via the dashboard's manual replay POST straight to the cloud API — to run the exact same routing/actuation sequence without any live plant signal required.
