# aep-outage-prediction

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

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
