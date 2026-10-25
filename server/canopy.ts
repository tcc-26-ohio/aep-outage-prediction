// Tree canopy cover around a point, from the NLCD Tree Canopy Cover grid (scripts/build-canopy.py -> public/gis/canopy.bin).
const GIS = new URL('../public/gis/', import.meta.url).pathname;

interface Grid { x0: number; y0: number; cell: number; w: number; h: number; nodata: number; data: Uint8Array }
let grid: Grid | null = null;

async function load(): Promise<Grid | null> {
  if (grid) return grid;
  try {
    const meta = (await Bun.file(GIS + 'canopy.json').json()) as Omit<Grid, 'data'>;
    grid = { ...meta, data: new Uint8Array(await Bun.file(GIS + 'canopy.bin').arrayBuffer()) };
  } catch { /* run scripts/build-canopy.py; without the grid canopy is simply unknown */ }
  return grid;
}

// EPSG:5070 (NAD83 / Conus Albers, GRS80), the grid's projection
const A = 6378137, F = 1 / 298.257222101, E2 = F * (2 - F), E = Math.sqrt(E2), rad = (d: number) => d * Math.PI / 180;
const m = (p: number) => { const s = Math.sin(rad(p)); return Math.cos(rad(p)) / Math.sqrt(1 - E2 * s * s); };
const q = (p: number) => { const s = Math.sin(rad(p)); return (1 - E2) * (s / (1 - E2 * s * s) - Math.log((1 - E * s) / (1 + E * s)) / (2 * E)); };
const N = (m(29.5) ** 2 - m(45.5) ** 2) / (q(45.5) - q(29.5));
const C = m(29.5) ** 2 + N * q(29.5);
const RHO0 = A * Math.sqrt(C - N * q(23)) / N;
function albers(lon: number, lat: number): [number, number] {
  const rho = A * Math.sqrt(C - N * q(lat)) / N, th = N * rad(lon + 96);
  return [rho * Math.sin(th), RHO0 - rho * Math.cos(th)];
}

/** Mean canopy cover (percent) of the 3 x 3 cells (about 90 m) around each point, or null when there is no grid or no data. */
export async function canopyAround(points: [number, number][]): Promise<{ mean: number; samples: number } | null> {
  const g = await load();
  if (!g) return null;
  let sum = 0, n = 0;
  for (const [lon, lat] of points) {
    const [x, y] = albers(lon, lat);
    const col = Math.floor((x - g.x0) / g.cell), row = Math.floor((g.y0 - y) / g.cell);
    let s = 0, c = 0;
    for (let r = row - 1; r <= row + 1; r++) for (let k = col - 1; k <= col + 1; k++) {
      if (r < 0 || k < 0 || r >= g.h || k >= g.w) continue;
      const v = g.data[r * g.w + k]!;
      if (v !== g.nodata) { s += v; c++; }
    }
    if (c) { sum += s / c; n++; }
  }
  return n ? { mean: sum / n, samples: n } : null;
}
