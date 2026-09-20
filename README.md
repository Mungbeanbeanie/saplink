# Saplink

A router for plants. Live at [saplink.us](https://saplink.us) (API: [api.saplink.us](https://api.saplink.us/api/health)).

## Inspiration
Old growth "mother trees" quietly run a forest through mycorrhizal fungal networks, sensing stress in nearby seedlings and routing water, nutrients, and defense signals to whoever needs them most. Logging removes those hub trees and leaves everything around them cut off from that support. We wanted to rebuild that network electronically, a Lorax sized problem answered with a router.

## What it does
Saplink is a router for plants and trees. Chlorided silver probes and a 16 bit ADC read a plant's bioelectric signals, an ESP32 conditions and classifies them, and the batch is posted over HTTPS into Saplink's cloud, which routes a stress alert back out to the wider network of nodes. The receiving node drives a peristaltic pump that delivers water or nutrients to a second plant, so plants keep sharing information the way they would through a mother tree, even after that tree is gone.

## How we built it
Hardware is an ESP32, an ADS1115 16 bit differential ADC, Ag/AgCl electrode probes in stem and soil, soil moisture sensors, a 5V relay, and a micro peristaltic pump. The firmware (C++ on PlatformIO) runs a median filter, an adaptive baseline auto zero, and a 3 sigma peak detector with a rebound check, then batches samples to the cloud over WiFi. The cloud is two Vultr instances behind Caddy TLS: a FastAPI backend on SQLite that stores and routes plant signals, and a React plus Tailwind dashboard at saplink.us.

## Challenges we ran into
Most of the weekend was hardware: sourcing the right parts, wiring them correctly, and proving with a multimeter and an I2C scanner that the ADC was actually talking to us. Plant signals live in the millivolt range, so 60 Hz mains hum aliased straight into our 10 Hz sample rate and looked identical to a real spike, which had the pump firing unprompted 11 times in 21 minutes. We fixed it by averaging every reading across one full mains period and adding sustain and amplitude gates to the detector, then had to get that data reliably up to the cloud and routed back down to a second board.

## Accomplishments that we're proud of
This was our first ever hardware hack, and we closed the entire loop: a real poke to a plant produced three alerts in 24 seconds, each one traveling from the probes to cloud SQLite and back to the board to run the pump. Every layer is real and live, from the electrodes to the deployed dashboard. Watching a living organism trigger a physical response through infrastructure we built was the moment biology and software genuinely met.

## What we learned
We learned how to carry a raw analog signal all the way to a product: conditioning it on the device, choosing what is worth transmitting, and presenting it so someone understands it at a glance. Data engineering turned out to be the real design problem, since uploading every sample was wasteful while uploading only events left the dashboard empty between spikes. We also learned that hardware always needs calibration knobs, because no sensor behaves the way its datasheet promises.

## What's next for Saplink
Scale and durability: many more nodes per site, a real mesh rather than a single router, and enclosures that survive a season outdoors. With enough probes in the ground, the same signal pipeline can flag forest fires early, since heat and drought stress register electrically in trees before any smoke is visible. Long term, we want Saplink deployed across replanted clearcuts, giving new growth back the support network that logging took away.

## Repo layout

```
esp32/Saplink/   firmware (PlatformIO); src/combo_main.cpp is the primary build
app/backend/     FastAPI + SQLite (main.py, news.py, weather.py)
app/frontend/    React + Vite + Tailwind dashboard
compose.*.yaml   one Docker Compose stack per box (api / web), each with Caddy
deploy.sh        ssh + git pull + compose up, per box
```

## Run it

```sh
# firmware (copy esp32/Saplink/include/secrets.h.example -> secrets.h first)
cd esp32/Saplink && pio run -e combo -t upload && pio device monitor

# frontend + fake local API
cd app/frontend && npm install && npm run dev

# backend
cd app/backend && pip install -r requirements.txt && uvicorn main:app --reload

# deploy
./deploy.sh api    # or: web, or nothing for both
```
