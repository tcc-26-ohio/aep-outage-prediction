# Current Tech Stack

The project is a **React + Python/FastAPI prototype**, branded **GridAhead**, with interactive mapping and local alert-preference storage. Real outage prediction is not connected yet.

Versions below reflect declared dependency ranges, not verified installed versions.

## Technologies

| Layer | Technology | Current role |
|---|---|---|
| Frontend | React 19, TypeScript 7 | Map interface, address search, and alert signup dialog |
| Build tooling | Vite 8, React plugin | Development server and production frontend builds |
| Styling | Plain CSS | Custom interface styling; no UI component framework |
| Mapping | Leaflet 1.9 | Interactive map, markers, zoom, and location selection |
| Map data | OpenStreetMap tiles | Base map imagery |
| Geocoding | Public Nominatim API | US address and ZIP-code searches |
| Backend | Python + FastAPI | JSON API for health checks, saved preferences, and demo assessments |
| API server | Uvicorn | Runs the Python application |
| Validation | Pydantic + email-validator | Request schemas and email validation |
| Database | SQLite, Python `sqlite3` | Local subscription storage; no ORM |
| ML scaffold | NumPy 2, scikit-learn 1.x, joblib 1.x | Synthetic training pipeline and model serialization |
| Package management | Bun; pip + venv | JavaScript dependencies/scripts and isolated Python dependencies |
| Testing | Python unittest + HTTPX | Backend API tests |
| Build checks | TypeScript type checking + Vite build | Frontend validation and bundling |
| Data downloads | Bash, curl, unzip | Download and extract source datasets |

## Architecture

```text
React / TypeScript frontend
├── Leaflet → OpenStreetMap tiles
├── fetch → Nominatim address search
└── /api → FastAPI / Uvicorn → SQLite

Separate training script
└── NumPy → StandardScaler + LogisticRegression → joblib artifact
```

During development, Vite proxies `/api` requests to `127.0.0.1:8000`. React uses built-in hooks for state and browser `fetch` for HTTP requests.

Subscription records are stored locally in `backend/storage/subscriptions.sqlite3`. The current frontend uses `/api/location-subscriptions`; the older demo assessment and premise-subscription routes remain available but are not used by the frontend.

## Current Capabilities

- Interactive map centered on Roanoke.
- US address and ZIP-code search.
- Saving location/email preferences with explicit consent.
- Demo assessment endpoints and API tests.

## Not Connected or Production-Ready

- Live weather, outage overlays, and real predictive inference.
- Restoration estimates and automated notification delivery.
- Authentication, email verification, rate limiting, and unsubscribe.
- Production hosting/deployment configuration.

The ML code is **only a synthetic smoke test**, not a validated outage model, and the API does not load it. Real training requires cleaned GIS/topology joins, historical weather, verified outcomes, event-based validation, and probability calibration.

For production, the frontend and `/api` should be served behind the same origin; the Vite proxy is development-only. Public map and geocoding services also require usage-policy and traffic considerations.

## Key Files

- `package.json`: frontend dependencies and development/build commands.
- `vite.config.ts`: React plugin and development API proxy.
- `tsconfig.json`: strict TypeScript configuration.
- `src/App.tsx`: map, location search, and alert-preference interface.
- `src/api.ts`: typed client for the older demo API routes.
- `src/styles.css` and `src/alerts.css`: custom styles.
- `backend/requirements.txt`: backend and ML dependency ranges.
- `backend/requirements-dev.txt`: additional testing dependencies.
- `backend/app/main.py`: FastAPI routes, validation, and SQLite persistence.
- `backend/tests/test_api.py`: backend API tests.
- `backend/train.py`: synthetic model-training entry point.
- `scripts/download-data.sh`: dataset download and extraction.

## Development Commands

```bash
# Install frontend dependencies
bun install

# Set up Python dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements-dev.txt

# Start frontend and backend together
bun run dev

# Type-check and build the frontend
bun run build

# Run backend tests with the virtual environment active
PYTHONPATH=backend python -m unittest discover -s backend/tests

# Run the synthetic training smoke test
python backend/train.py

# Download source datasets
bun run data:pull
```
