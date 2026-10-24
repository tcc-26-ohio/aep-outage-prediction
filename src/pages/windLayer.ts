import L from "leaflet";

export type WindField = { lats: number[]; lons: number[]; u: number[]; v: number[] };
type Particle = { x: number; y: number; age: number; life: number };

const COUNT = 1400;
const colorFor = (mph: number) => (mph < 10 ? "#78a9ff" : mph < 20 ? "#0f62fe" : mph < 30 ? "#6929c4" : "#9f1853");

// Animated streamlines on a canvas above the map. Particles live in screen space; each frame the wind under
// a particle is looked up from the grid, so panning and zooming need no special handling beyond clearing trails.
export function createWindLayer(map: L.Map) {
  const container = map.getContainer();
  const canvas = document.createElement("canvas");
  canvas.className = "wind-canvas";
  canvas.setAttribute("aria-hidden", "true");
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let field: WindField | null = null;
  let particles: Particle[] = [];
  let frame = 0;

  const resize = () => { canvas.width = container.clientWidth; canvas.height = container.clientHeight; ctx.clearRect(0, 0, canvas.width, canvas.height); if (reduced) drawStatic(); };
  const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height);

  function sample(lat: number, lon: number): [number, number] | null {
    if (!field) return null;
    const { lats, lons } = field;
    const fy = (lat - lats[0]!) / (lats[lats.length - 1]! - lats[0]!) * (lats.length - 1);
    const fx = (lon - lons[0]!) / (lons[lons.length - 1]! - lons[0]!) * (lons.length - 1);
    if (fy < 0 || fx < 0 || fy > lats.length - 1 || fx > lons.length - 1) return null;
    const y0 = Math.min(lats.length - 2, Math.floor(fy)), x0 = Math.min(lons.length - 2, Math.floor(fx));
    const ty = fy - y0, tx = fx - x0, nx = lons.length;
    const at = (arr: number[], y: number, x: number) => arr[y * nx + x]!;
    const lerp = (arr: number[]) => (at(arr, y0, x0) * (1 - tx) + at(arr, y0, x0 + 1) * tx) * (1 - ty) + (at(arr, y0 + 1, x0) * (1 - tx) + at(arr, y0 + 1, x0 + 1) * tx) * ty;
    const u = lerp(field.u), v = lerp(field.v);
    return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : null;
  }

  const spawn = (): Particle => ({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, age: 0, life: 40 + Math.random() * 60 });
  const wind = (p: Particle) => { const ll = map.containerPointToLatLng(L.point(p.x, p.y)); return sample(ll.lat, ll.lng); };

  function step() {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.07)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1.4;
    for (const p of particles) {
      const w = wind(p);
      if (!w || p.age++ > p.life) { Object.assign(p, spawn()); continue; }
      const nx = p.x + w[0] * 0.1, ny = p.y - w[1] * 0.1;
      ctx.strokeStyle = colorFor(Math.hypot(w[0], w[1]));
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
      p.x = nx; p.y = ny;
    }
    frame = requestAnimationFrame(step);
  }

  function drawStatic() {
    clear();
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 500; i++) {
      const p = spawn(); const w = wind(p);
      if (!w) continue;
      ctx.strokeStyle = colorFor(Math.hypot(w[0], w[1]));
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + w[0] * 1.2, p.y - w[1] * 1.2); ctx.stroke();
    }
  }

  const onMove = () => (reduced ? drawStatic() : clear());
  map.on("movestart zoomstart", clear).on("moveend zoomend", onMove).on("resize", resize);
  resize();
  if (!reduced) { particles = Array.from({ length: COUNT }, spawn); frame = requestAnimationFrame(step); }

  return {
    setField(next: WindField) { field = next; if (reduced) drawStatic(); },
    remove() {
      cancelAnimationFrame(frame);
      map.off("movestart zoomstart", clear).off("moveend zoomend", onMove).off("resize", resize);
      canvas.remove();
    },
  };
}
