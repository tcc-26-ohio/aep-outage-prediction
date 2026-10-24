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

Try `DEMO-001`, `DEMO-002`, or `DEMO-003` to see different risk labels.
All weather, risk labels, and circuit profiles are illustrative. The API does
not read customer GIS records, ingest live weather, or run a validated model.
Enrollment requires consent and stores email addresses locally in
`backend/storage/subscriptions.sqlite3`; it does not send or verify emails.
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
proxy is development-only. Live weather, GIS ingestion, trained inference,
maps, and scheduled notifications are future integrations.

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
