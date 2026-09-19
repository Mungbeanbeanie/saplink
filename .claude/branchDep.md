# Third-Party & Board-Package Version Tracking

Nothing below is installed yet — plan.md's phases haven't been implemented. These are target versions to pin when each file is actually built; PlatformIO/npm/PyPI registries should be re-checked at that time since these drift.

## Firmware (PlatformIO `lib_deps`, `esp32/Saplink/platformio.ini`)

| Library | Target version (verify at install) | Used by |
|---|---|---|
| Adafruit ADS1X15 | latest on PlatformIO registry | ADC read in combo/sensor main |
| ArduinoJson | latest 7.x | packet_schema.h serialization, cloud_client.h |
| ESP32 Arduino core (`platform = espressif32`) | pin the exact platform version once picked, not left floating | all esp32dev envs |

No pending bumps yet — nothing pinned to bump from.

## Backend (`app/backend/requirements.txt`)

| Package | Target version (verify at install) | Notes |
|---|---|---|
| fastapi | latest stable (0.13x line as of this research) | API framework |
| uvicorn | matches fastapi's supported range | ASGI server |
| sqlalchemy | 2.0.x | ORM / Postgres access |
| psycopg2-binary | latest 2.9.x | Postgres driver |
| pydantic | 2.10.x+ (v2) | request/response schemas |

No pending bumps yet — nothing pinned to bump from.

## Frontend (`app/frontend/package.json`)

| Package | Target version (verify at install) | Notes |
|---|---|---|
| react / react-dom | latest stable, verify at install | UI |
| vite | 8.x | dev server/bundler |
| tailwindcss | 4.3.x+ | styling — v4's Vite plugin (`@tailwindcss/vite`) replaces the old PostCSS-plugin setup; confirm which setup path at implementation time |
| postcss / autoprefixer | only needed if not using `@tailwindcss/vite`'s plugin path | see tailwindcss note above |

No pending bumps yet — nothing pinned to bump from.
