#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -x .venv/bin/python ]]; then
  echo "Missing Python virtual environment. Set up the backend first:" >&2
  echo "  python3 -m venv .venv" >&2
  echo "  .venv/bin/python -m pip install -r backend/requirements-dev.txt" >&2
  exit 1
fi

if ! .venv/bin/python -c 'import uvicorn' >/dev/null 2>&1; then
  echo "Missing backend dependencies. Run:" >&2
  echo "  .venv/bin/python -m pip install -r backend/requirements-dev.txt" >&2
  exit 1
fi

# Forward Ctrl+C to both process trees, including Uvicorn's reload worker.
# If either server exits, terminate the other rather than leaving it running.
exec ./node_modules/.bin/concurrently --kill-others \
  --names web,api --prefix-colors cyan,green \
  "bun run dev:web" "bun run dev:api"
