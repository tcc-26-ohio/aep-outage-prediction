// Data layer: loads the Data1 + Data2 circuit join and storm events from /api/outlook and
// turns them into the per-window, per-region numbers every tab reads.
import { useEffect, useMemo, useState } from "react";

export type RegionName = "Central" | "East" | "South" | "North";
export type RegionFilter = RegionName | "All";
export type SortKey = "reports" | "customers" | "history" | "name";
export type Filters = { region: RegionFilter; window: string; sort: SortKey };
export type Circuit = {
  id: string; station: string; circuit: string; region: RegionName; lat: number; lon: number; weight: number; exposure: number;
  damage: number; unrepaired: number; transformers: number; reclosers: number; switches: number; fuses: number;
  secondary: number; primary_km: number; customers: number; events: Record<string, number>;
};
export type EventDay = { date: string; reports: number; regions: Partial<Record<RegionName, number>> };
export type StormEvent = {
  id: string; start: string; end: string; reports: number; unrepaired: number; access_issues: number; circuits: number; customers: number;
  median_repair_days: number | null; significant: boolean; types: Record<string, number>; regions: Partial<Record<RegionName, number>>; days: EventDay[];
};
export type OutlookData = { circuits: Circuit[]; events: StormEvent[] };
export type Row = Circuit & { count: number };

export const REGIONS: RegionName[] = ["Central", "East", "South", "North"];
export const ALL = "all";
export const DEFAULT_FILTERS: Filters = { region: "All", window: ALL, sort: "reports" };
export const SORTS: [SortKey, string][] = [["reports", "Damage reports"], ["customers", "Customers served"], ["history", "All-time reports"], ["name", "Name"]];
export const LEVEL_COLORS = ["#ffffff", "#f1e319", "#f5a800", "#e8261c", "#8a1aa0"];
export const LEVEL_LABELS = ["–", "Elevated", "L1", "L2", "L3"];

const parse = (iso: string) => new Date(`${iso}T00:00:00`);
const fmt = (date: Date, options: Intl.DateTimeFormatOptions) => date.toLocaleDateString("en-US", options);

export function eventLabel(event: Pick<StormEvent, "start" | "end">) {
  const a = parse(event.start), b = parse(event.end);
  if (event.start === event.end) return fmt(a, { month: "short", day: "numeric", year: "numeric" });
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${fmt(a, { month: "short", day: "numeric" })}–${b.getDate()}, ${b.getFullYear()}`;
  return `${fmt(a, { month: "short", day: "numeric" })} – ${fmt(b, { month: "short", day: "numeric", year: "numeric" })}`;
}
export const dateLabel = (iso: string) => fmt(parse(iso), { weekday: "short", month: "short", day: "numeric" });

// Spread a total across weights as whole numbers that still add up to the total.
export function allocate(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const shares = weights.map(w => w / sum * total);
  const counts = shares.map(Math.floor);
  let left = total - counts.reduce((a, b) => a + b, 0);
  shares.map((share, index) => ({ index, rest: share - Math.floor(share) })).sort((a, b) => b.rest - a.rest)
    .forEach(({ index }) => { if (left-- > 0) counts[index]!++; });
  return counts;
}

export function useOutlookData() {
  const [data, setData] = useState<OutlookData>({ circuits: [], events: [] });
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    fetch("/api/outlook").then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then((body: OutlookData) => setData(body))
      .catch(() => setLoadError("Circuit data unavailable. Start the backend and make sure Data1 and Data2 are extracted."));
  }, []);
  return { data, loadError };
}

// Levels are relative to the window: the busiest circuits are L3, so they stay meaningful for a
// 1,200-report storm and a 12-report one alike.
export function makeLevelFor(counts: number[]) {
  const positive = counts.filter(count => count > 0).sort((a, b) => a - b);
  const at = (share: number) => positive[Math.min(positive.length - 1, Math.floor(positive.length * share))] ?? 1;
  const mins = [0, 1];
  for (const share of [0.55, 0.8, 0.95]) mins.push(Math.max(at(share), mins[mins.length - 1]! + 1));
  const levelFor = (count: number) => {
    const index = mins.reduce((best, min, i) => count >= min ? i : best, 0);
    return { label: LEVEL_LABELS[index]!, color: LEVEL_COLORS[index]!, index };
  };
  return { levelFor, mins };
}

export function useOutlook(data: OutlookData, { region, window: windowId, sort }: Filters) {
  const event = data.events.find(item => item.id === windowId);
  const rows = useMemo<Row[]>(() => data.circuits.map(c => ({ ...c, count: event ? c.events[event.id] ?? 0 : c.damage })), [data.circuits, event]);
  const level = useMemo(() => makeLevelFor(rows.map(row => row.count)), [rows]);
  const regionStats = useMemo(() => REGIONS.map(name => {
    const own = rows.filter(row => row.region === name);
    return { name, circuits: own, count: own.reduce((sum, row) => sum + row.count, 0), customers: own.reduce((sum, row) => sum + row.customers, 0) };
  }), [rows]);

  const inScope = (row: Row) => region === "All" || row.region === region;
  const scoped = rows.filter(inScope);
  const countFor = (id: string) => scoped.reduce((sum, row) => sum + (id === ALL ? row.damage : row.events[id] ?? 0), 0);
  return {
    rows, regionStats, scoped, inScope, event, levelFor: level.levelFor, countFor,
    label: event ? eventLabel(event) : "All history",
    total: scoped.reduce((sum, row) => sum + row.count, 0),
    customersAtRisk: scoped.filter(row => row.count > 0).reduce((sum, row) => sum + row.customers, 0),
    worst: [...scoped].sort((a, b) => b.count - a.count)[0],
    shownRegions: regionStats.filter(stat => region === "All" || stat.name === region)
      .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : b.count - a.count),
    maxRegion: Math.max(1, ...regionStats.map(stat => stat.count)),
  };
}
export type OutlookView = ReturnType<typeof useOutlook>;

export const sortRows = (list: Row[], sort: SortKey) => [...list].sort({
  reports: (a: Row, b: Row) => b.count - a.count, customers: (a: Row, b: Row) => b.customers - a.customers,
  history: (a: Row, b: Row) => b.damage - a.damage, name: (a: Row, b: Row) => a.id.localeCompare(b.id, undefined, { numeric: true }),
}[sort]);

// Props every tab receives from App.
export type PageProps = {
  data: OutlookData; view: OutlookView; filters: Filters; loadError: string;
  update: (patch: Partial<Filters>) => void; go: (tab: string) => void;
};
