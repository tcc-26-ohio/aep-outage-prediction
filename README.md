# aep-outage-prediction

To install dependencies:

```bash
bun install
```

## Chat app

Vite/React frontend with a Hono backend, using the Vercel AI SDK and Groq.
Users and Workers have separate conversations (kept in memory while the page is open).
Outage prediction, live status checks, and report submission are not implemented.

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
The interface tabs are presentation only, not authentication or role-based access control.

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
