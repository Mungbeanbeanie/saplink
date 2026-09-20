# Saplink

**A Wi-Fi router for plants.**

## The problem

Old-growth forests have "mother trees" — big, established trees connected to everything around them through an underground fungal network. When a nearby seedling is stressed (drought, a wound, a pest), the mother tree senses it and routes water, nutrients, and defense signals to help it survive.

Clear-cut logging removes those hub trees. The network goes with them. Replanted seedlings are on their own, with no relay system to lean on.

## The idea

Build an electronic stand-in for that lost relay: a small sensor that reads a plant's electrical activity, puts it on the network, and triggers a support response — automatically, in seconds, without a person watching a screen.

Think of it as a Wi-Fi router, but for a plant's stress signal instead of internet traffic.

## How it works

1. **Sense** — Two probes clipped to a plant's stem read its natural bioelectric signal (the same kind of signal that spikes when a plant is wounded, dried out, or under attack).
2. **Route** — An ESP32 board streams that signal over Wi-Fi to a cloud server, which watches for a real spike (not noise) using the same 3-sigma-and-rebound math researchers use to classify plant action potentials.
3. **Respond** — When a real spike fires, the cloud tells the board to act: right now, that means dosing water/nutrients to a *second* plant from the same board — proving the "one plant's stress helps another plant" loop end-to-end.

## What's actually working today

- Real plant, real electrodes, real signal — not a simulation.
- Live cloud dashboard (`saplink.us`) showing the signal, the network, and every device reporting in.
- The full loop has fired for real: a plant poke produced multiple alerts that round-tripped from the plant → the cloud → back to the board → an actuator, automatically.
- Built on ~$100 of off-the-shelf parts (ESP32, ADC, a pump, some wire) and two small cloud servers — no custom hardware, nothing proprietary.

## Why it matters

This is a working proof that a "mother tree" relationship can be rebuilt electronically: sense stress in one plant, route it, and turn it into real support for another. The same pattern scales past a desk demo — a network of these across a reforestation site could flag which seedlings are struggling and trigger irrigation or nutrient response automatically, restoring at machine speed a support system that used to take a forest decades to grow.
