#!/usr/bin/env bash
set -euo pipefail

# Resolve paths relative to the project, not the caller's working directory.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"
BASE_URL="https://raw.githubusercontent.com/hackohio/aep_challenge_hack26/main/data/raw"

for command in curl unzip; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

mkdir -p "$DATA_DIR"
trap 'rm -f "$DATA_DIR"/*.zip.part' EXIT

for name in Data1 Data2 matched_upstream; do
  archive="$DATA_DIR/$name.zip"
  destination="$DATA_DIR/$name"

  if [[ ! -f "$archive" ]]; then
    echo "Downloading $name.zip..."
    curl --fail --location --retry 3 \
      --output "$archive.part" "$BASE_URL/$name.zip"
    mv "$archive.part" "$archive"
  else
    echo "Using existing $name.zip"
  fi

  echo "Extracting into $destination..."
  mkdir -p "$destination"
  unzip -q -o "$archive" -d "$destination"
done

echo "Datasets ready in $DATA_DIR"
