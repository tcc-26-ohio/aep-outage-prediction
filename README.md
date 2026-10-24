# aep-outage-prediction

GridGuide: a Vite/React frontend with a Hono/Bun backend. It has three parts that share one codebase:

| Page | URL (dev) | What it is |
| --- | --- | --- |
| Chat app | `/` | Users/Workers AI chat (Vercel AI SDK + Groq) with community outage reports |
| Network map | `/map.html` | Interactive GIS map of the distribution network, ARCOS damage, isolation planning and issue prioritization |
| Client chat | `/client.html` | Customer-facing chat: find your premise by address, check status, get an estimated restoration window |

```bash
bun install
```

## Running

Copy `.env.example` to `.env` and set `GROQ_API_KEY` (only the chat app needs it). Optionally set `GROQ_MODEL` (defaults to `llama-3.3-70b-versatile`), `PORT`, `DATABASE_PATH`.

```bash
bun run dev          # Vite (http://localhost:5173) + API server (port 3001)
bun run typecheck
bun run build        # builds all three pages
bun run start        # production: built frontend + API on http://localhost:3001
bun test             # database tests
```

Vite proxies `/api` to the Hono server on port 3001. If you change `PORT`, update the proxy target in `vite.config.ts` too. The API key is only read by the backend; never prefix it with `VITE_`. The map page works without the API server except for the debug address lookup; the client chat needs it.

## Data setup

The map and client chat need the AEP shapefiles and a generated GIS dataset. Both are git-ignored (`data/`, `public/gis/`), so build them after cloning.

1. **Download** (needs `curl` and `unzip`):

   ```bash
   bun run data:pull    # or: bash scripts/download-data.sh
   ```

   Downloads the three ZIPs into `./data` and extracts `data/Data1/`, `data/Data2/` and `data/matched_upstream/`. Existing ZIPs are reused; extracted files are overwritten.

2. **Build the GIS dataset.** Needs a Python virtualenv at `.venv` with `pyshp` and `numpy`:

   ```bash
   python3 -m venv .venv && .venv/bin/pip install pyshp numpy
   bun run gis:build
   ```

   `gis:build` runs two scripts:
   - `scripts/build-gis.py` merges Data1 + Data2 into GeoJSON under `public/gis/` (primary/secondary conductors, poles, transformers, fuses, switches, reclosers, ARCOS damage, hospitals, fire stations, ambulance, anonymized customers), plus `chains.json`/`topology.json`/`anchors.json` from `matched_upstream.txt`, and a private address index at `data/premise-addresses.json`.
   - `scripts/build-isolation.py` adds an isolation point to every ARCOS report (see below) and writes `opendown.json`.

   Premise pseudo-IDs use a random salt, so **every rebuild changes them**. Re-run both scripts together (that is what `gis:build` does).

## Network map (`/map.html`)

Left panel tabs: **Layers**, **Inspect**, **Issues**, **Data**.

- **Layers.** Every layer toggles on/off with Select all / Clear per section (Network, Sectionalizing devices, Impact, Emergency services). Each layer has attribute filters with live counts (phases, voltage, mounting, state, facility names...). Primary conductors are colored and sized by phase count; dashed = underground. Large layers (secondary, premises, poles) load on demand. Basemaps: Dark, Streets, Satellite. A circuit selector highlights and zooms to a whole circuit.
- **Equipment order.** Derived from `matched_upstream.txt`, not hard-coded: the equipment classes between a premise and the breaker (transformer, fuses, reclosers, sectionalizers, step transformers), how common each is, and the most common orderings. Click an ordering to highlight every transformer that follows it.
- **Inspect.** Click a premise, transformer, device, pole, conductor or damage report to see its attributes and connections: serving transformer, secondary network, and the numbered upstream equipment path (dashed line + highlighted primary route). Clicking a protective device shows how many transformers and premises are downstream.
- **ARCOS damage.** Reports are filterable by damage type and asset type. Each report shows **person-hours** (`src/map/labor.ts`): remove + install of the matching compatible units × the 4.5 indirect labor multiplier. Poles and transformers use size-group averages; wire is costed as splice/termination hardware; access and site adders are not applied. The mapping table at the top of that file is the place to adjust assumptions.
- **Isolation plan.** For each report the build finds the device to open so the fewest customers lose power: the nearest closed fuse, recloser or switch between the damage and the source (direction comes from the matched upstream paths). Clicking a report draws a red "open here" marker, a dashed line to it, and highlights the de-energized transformers and premises. If nothing can sectionalize the damage, the card says the substation breaker is the only option. Back-feed from normally-open ties is not modelled.
- **Issues.** Pick damage reports (default: not yet repaired), then **Prioritize** to get a ranked list, exportable as CSV. Score = customers off ×1 + life-support customers ×50 + a hospital (400) / fire station (150) / ambulance (150) within 500 m of the damage or any de-energized transformer (×0.4 out to 1.5 km). Weights live in `src/map/priority.ts`. The list and ranking persist while you click through issues.
- **Debug.** *Show premise addresses* (Layers tab) adds the street address and location ID to a selected premise's attributes via the API. Off by default; premises are otherwise anonymous.

Premises on the map carry only an anonymous ID, service type and customer count. Names, addresses, premise numbers and meters are never written to `public/`.

## Client chat (`/client.html`)

1. The chat first asks for the customer's **service address**. The server (`GET /api/premises/search?q=`) matches it against `data/premise-addresses.json` and returns at most 8 results; the address list is never sent to the browser. The source data has no street suffixes or ZIP codes, so addresses read like `2347 Gardner, Elliston, VA`. The shapefile's own `address` field is empty for every record; addresses are assembled from `anno_strin` + `road_name` + `city`. The chosen premise is remembered in `localStorage`.
2. Quick actions: **Check my outage status** (open utility damage reports whose isolation would also cut this premise), **When will power return?** (a range of hours from now, derived from the repair work divided by a crew of 2 to 8; set `CREW_MIN`/`CREW_MAX` in `server/premises.ts`), and **Safety tips**.
3. The bug icon opens debug options: include already-repaired outages (so the storm data shows results), and show location IDs. Both are off by default.

The message box is not wired to a model; customers interact through the action buttons. Customers cannot file outage reports here.

**Before exposing this publicly:** the premise endpoints (`/api/premises/*`) have no authentication or rate limiting, so anyone who can reach the server can look up an address and learn its circuit and service type. Put them behind sign-in first. Restoration times are estimates from standard repair hours, not utility commitments.

## Chat app (`/`)

Users and Workers have separate conversations (kept in memory while the page is open). Chat tools let users report outages and find nearby community reports, and let workers mark reports resolved. Bun's built-in SQLite stores reports in `data/outages.sqlite` (override with `DATABASE_PATH`); the database is created on startup. Outage prediction and official utility status are not implemented.

Supply an address/place name or latitude/longitude in chat. Place names are geocoded through OpenStreetMap Nominatim; ambiguous matches require clarification. The assistant asks for confirmation before submitting or resolving reports. Nearby searches default to 25 km (maximum 200 km), return up to 100 nearest reports, and exclude resolved reports unless requested in worker mode. Do not include private details in reports: they are visible to other users through searches.

Nominatim's public endpoint is intended for light prototype use; production should use a geocoding service with appropriate capacity and usage controls.

The interface tabs are presentation only, not authentication or role-based access control. The server only exposes the resolution tool in worker mode, but anyone can select that mode. Add authenticated worker roles before exposing this prototype publicly. Mutation confirmation is enforced through assistant instructions, not a separate authorization boundary.

## Project layout

```
index.ts                  Hono API (chat, premise lookup/status)
server/                   outages store, chat tools, premise search + status
scripts/                  download-data.sh, build-gis.py, build-isolation.py
src/main.tsx              chat app
src/map/                  map page (MapPage, store, layers, filters, labor, priority, IssuesPanel)
src/client/               client chat page
public/gis/               generated GeoJSON (git-ignored)
data/                     downloaded shapefiles + private address index (git-ignored)
```

This project was created using `bun init` in bun v1.4.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
