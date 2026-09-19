 System Overview

A two-plant bioelectric relay: Plant A's stress signal is sensed, classified, and routed wirelessly to prime and support Plant B — no literal neural/connectome model, just a robust threshold detector dressed as one.
System Architecture
flowchart LR
    A[Plant A - Origin<br/>stressed] -->|probes in stem/soil| S[Sensing Node<br/>ESP32 + ADS1115]
    S -->|ESP-NOW/LoRa packet<br/>VP spike alert| R[Actuator Node<br/>ESP32 + relay]
    R -->|micro-dose pump| B[Plant B - Target<br/>primed/supported]
    REC[(Recorded signal<br/>fallback)] -.replaces live A/S on demo failure.-> R
Real bioelectric responses propagate over tens of seconds to minutes, not instantly. The live demo narrates through that window rather than expecting an immediate reaction, and a pre-recorded signal replay (dashed path above) is the guaranteed fallback if the live plant doesn't cooperate on stage.
Subsystem Breakdown
1. Sense (inbound data)
• Interface: 18-gauge fine silver wire electrodes, chlorided via brief electrolysis or diluted-bleach dip (bare silver is noisier than true Ag/AgCl, but chloriding closes most of the gap and is sourceable same-day). One pair in the stem base, one in rhizosphere soil.
• Signal capture: ADS1115 16-bit differential ADC reading 0.1-100 mV variation/action potentials.
• Signal conditioning: median or notch filter (not a plain moving average, which barely touches 60 Hz mains hum) plus a rolling baseline/auto-zero on the ESP32. Plant baselines drift over minutes independent of any stimulus — without auto-zero, the threshold either false-triggers or never fires.
• Reference placement: test electrode/reference placement and soil moisture consistency early; this is the single most likely source of garbage data if rushed.
2. Route (wireless data plane)
• Edge classifier: peak-detection on the sensing ESP32, firing on a sustained ΔV past threshold (post auto-zero).
• Protocol: ESP-NOW or sub-GHz LoRa, no Wi-Fi/cellular dependency.
• Serial/packet schema: lock the JSON/CSV field layout between ESP32 and any dashboard code before both are built independently — a mismatched schema discovered late is a classic time-sink.
3. Actuate (outbound response)
• Trigger: receiver ESP32 parses the alert packet, drives a 5V relay.
• Primary actuator: 5V micro peristaltic pump, dispensing a saline or defense-priming proxy into Plant B's soil.
• Reliability fallback: the pump is the most failure-prone link in the chain (jams, tubing kinks, priming issues). Keep a simpler backup indicator ready — an LED/buzzer "target primed" signal that fires off the same relay trigger — so a stuck pump doesn't kill the demo moment.
• Optional: liquid nutrient/hydration dose to simulate the carbon/water flux a fungal network hub would otherwise supply.
Hardware Bill of Materials
Component
Qty
Function
Sourcing
ESP32 microcontrollers
2
Node 1 (sensor) + Node 2 (actuator) execution
Micro Center / Amazon overnight
ADS1115 16-bit ADC
1
Precision differential voltage measurement
Micro Center / Adafruit
18-gauge fine silver wire
2 pairs
Electrode probes (stem + soil), chlorided before use
Craft/jewelry supply or Amazon
5V relay module
1
High-current switch for the pump
Micro Center / Amazon
5V micro peristaltic pump
1
Fluid dispensing onto Plant B
Amazon overnight
LED + buzzer
1
Backup "target primed" indicator if the pump fails
Micro Center
Potted houseplants
2
Plant A (origin), Plant B (target)
Local grocery / Home Depot
Reference probe pair
1
Control-plant baseline, shows the system isn't reacting to ambient noise
Same silver wire stock
Multimeter
1
Voltage-check wiring during assembly and debugging
Micro Center
Data-capable USB cables
2