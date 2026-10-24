# aep-outage-prediction

To install dependencies:

```bash
bun install
```

## Chat app

Vite/React frontend with a Hono backend, using the Vercel AI SDK and Groq.
Users and Workers have separate conversations (kept in memory while the page is open).
Chat tools let users report outages and find nearby community reports, and let workers mark reports resolved. Bun's built-in SQLite stores reports in `data/outages.sqlite` (override with `DATABASE_PATH`). The database is created automatically on startup. Outage prediction and official utility status are not implemented.

Supply an address/place name or latitude/longitude in chat. Place names are geocoded through OpenStreetMap Nominatim; ambiguous matches require clarification. The assistant asks for confirmation before submitting or resolving reports. Nearby searches default to 25 km (maximum 200 km), return up to 100 nearest reports, and exclude resolved reports unless requested in worker mode. Reports include coordinates, description, status, and timestamps. Do not include private details in reports: they are visible to other users through searches.

Nominatim's public endpoint is intended for light prototype use; production should use a geocoding service with appropriate capacity and usage controls.

Copy `.env.example` to `.env` and set `GROQ_API_KEY` to your Groq API key.
Optionally set `GROQ_MODEL` (defaults to `llama-3.3-70b-versatile`).

To run both development servers:

```bash
bun run dev
```

Open the Vite URL shown in the terminal (normally http://localhost:5173).
Vite proxies `/api` to the Hono server on port 3001. If you change `PORT`,
update the proxy target in `vite.config.ts` too.

```bash
bun run typecheck
bun run build
bun run start
```

Production serves the built frontend and API together at http://localhost:3001.
The API key is only read by the backend; never prefix it with `VITE_`.
The interface tabs are presentation only, not authentication or role-based access control. The server only exposes the resolution tool in worker mode, but anyone can select that mode. Add authenticated worker roles before exposing this prototype publicly. Mutation confirmation is enforced through assistant instructions, not a separate authorization boundary.

Run database tests with `bun test`.

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
