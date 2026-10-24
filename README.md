# aep-outage-prediction

To install dependencies:

```bash
bun install
```

## Run the app

Start both the React/Vite frontend and Python API together:

```bash
bun run dev
```

On first run, set up the Python environment before starting development:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements-dev.txt
```

`bun run dev` starts both servers with labeled output. Ctrl+C stops both;
if either server exits, the other is stopped automatically. No virtual-environment
activation is needed for this command. To run servers independently, use
`bun run dev:web` or `bun run dev:api`.

Open the Vite URL (usually http://localhost:5173). Vite proxies `/api` to
http://127.0.0.1:8000. API docs: http://127.0.0.1:8000/docs.

The frontend opens directly to an interactive OpenStreetMap centered on Roanoke.
Search by US address or ZIP code; submitted searches are sent to the public
Nominatim geocoding service. Map tiles and search require internet access. No
live weather, live outage overlays, risk predictions, or restoration estimates are
connected. For production, configure a geocoding/tile provider appropriate to
your traffic and its usage policies.
The automatic-alert dialog saves a location and email with explicit consent in
`backend/storage/subscriptions.sqlite3`; it does not send or verify emails or
confirm utility eligibility. The original demo API routes remain for development
but are no longer used by the frontend.
Use test addresses only. Authentication, rate limiting, contact verification,
unsubscribe, and notification delivery are required before public deployment.

## Checks and model scaffold

```bash
bun run build
source .venv/bin/activate
PYTHONPATH=backend python -m unittest discover -s backend/tests
python backend/train.py
```

`backend/train.py` uses NumPy and scikit-learn to train a **synthetic pipeline
smoke test**, saved under `backend/models/`. It is deliberately not used by the
API. Real training needs cleaned GIS/topology joins, historical weather,
verified outcomes, event-based validation, and probability calibration.
Only load trusted model artifacts: joblib files can execute code when loaded.

### Project layout

- `src/`: React dashboard, typed API client, styles.
- `backend/app/`: FastAPI assessment and demo enrollment routes.
- `backend/tests/`: API tests using isolated temporary storage.
- `backend/train.py`: synthetic model-training entry point.
- `scripts/download-data.sh`: download and extract the original archives.

For deployment, serve the frontend and `/api` behind the same origin; the Vite
proxy is development-only. Live weather, trained inference,
and scheduled notifications are future integrations.

For separate frontend and API hosts, set the frontend build variable
`VITE_API_BASE_URL` to the API origin and set the API variable `FRONTEND_ORIGIN`
to the frontend origin. For Render, these are the backend and frontend
`onrender.com` URLs, respectively, without trailing slashes.

## GIS map overlays

The backend reads the downloaded shapefiles directly and serves GeoJSON from
`GET /api/layers/{name}`. Available layers: `damage`, `primary`, `hospitals`,
`fire`, and `ems`. `GET /api/layers` lists availability. Optional `bbox` uses
`west,south,east,north`; `limit` caps results at up to 10,000 features.
The frontend refreshes selected layers as the map moves, displays truncation
notices, and shows source attributes when features are clicked.
Facility coordinates are converted from Web Mercator to WGS84. Historical
damage is not a live outage feed; repair flags are not independently verified.
Customer locations and medical flags are never exported by these endpoints.
Layers are cached in process; restart the backend after replacing source files.

## Historical weather

Install backend dependencies, then run:

```bash
bun run weather:pull --list-cities
bun run weather:pull
# Smaller download:
bun run weather:pull --city ROANOKE --city VINTON --start 2025-02-01 --end 2025-02-28
```

`scripts/download_weather.py` derives Virginia city centroids from customer
geometry and downloads hourly temperature, precipitation, rain, snowfall,
wind speed, and gusts from Open-Meteo's Historical Weather API. By default,
dates span seven days before the first damage report through the last report,
capped at six days before today for archive availability. Future-dated reports
cannot have historical weather yet. Requests are sequential, retried, and cached
in `data/weather/raw/`; rerun the same command after an interrupted download.
Each city gets an hourly CSV, with units, attribution, grid coordinates, and
completion status recorded in `data/weather/manifest.json`. Missing weather
values remain blank, never replaced with zero. Output is Git-ignored.

These are **historical gridded estimates, not archived forecasts**. City-level
samples are a starting point, not exact conditions at each asset. Timestamps
are UTC: convert to local time before joining to local damage-report dates.
Use archived forecasts for advance-warning validation. Ice accumulation is not
measured by this download. The script does not train or wire weather into the API.
The public API is subject to Open-Meteo usage limits and noncommercial terms;
review provider terms and attribution requirements before production use.

## Download datasets

Requires `curl` and `unzip`. Run:

```bash
bun run data:pull
# Or: bash scripts/download-data.sh
```

Downloads the three dataset ZIPs into `./data` and extracts each into its own
folder: `data/Data1/`, `data/Data2/`, and `data/matched_upstream/`.
Existing ZIPs are reused on subsequent runs; extracted files are overwritten.
The `data` directory is ignored by Git.

This project was created using `bun init` in bun v1.4.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
