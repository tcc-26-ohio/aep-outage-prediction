import { jsonSchema, tool } from 'ai';
import { createOutageStore, type Coordinates } from './outages';

const store = createOutageStore();
// Public Nominatim permits at most one request per second per application.
let geocodeQueue: Promise<unknown> = Promise.resolve();
let lastGeocodeAt = 0;
const geocodeCache = new Map<string, { matches: { latitude: number; longitude: number; label: string }[]; attribution: string }>();
const coordinates = { latitude: { type: 'number' as const, minimum: -90, maximum: 90 }, longitude: { type: 'number' as const, minimum: -180, maximum: 180 } };
const safe = async (operation: () => unknown) => {
  try { return await operation(); } catch (error) { return { error: error instanceof Error ? error.message : 'Operation failed.' }; }
};

export function outageTools(worker: boolean) {
  return {
    geocodeLocation: tool({
      description: 'Convert an address or place name supplied by the user to latitude/longitude. Returns possible matches; ask the user to choose if ambiguous. Location text is sent to OpenStreetMap Nominatim.',
      inputSchema: jsonSchema<{ query: string }>({ type: 'object', properties: { query: { type: 'string', minLength: 3, maxLength: 500 } }, required: ['query'], additionalProperties: false }),
      execute: ({ query }) => safe(async () => {
        if (query.trim().length < 3 || query.length > 500) throw new Error('Provide a more specific address or place name.');
        const lookup = geocodeQueue.then(async () => {
          const key = query.trim().toLowerCase();
          const cached = geocodeCache.get(key);
          if (cached) return cached;
          await Bun.sleep(Math.max(0, 1100 - (Date.now() - lastGeocodeAt)));
          lastGeocodeAt = Date.now();
          const url = new URL('https://nominatim.openstreetmap.org/search');
          url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5' }).toString();
          const response = await fetch(url, { headers: { 'User-Agent': 'GridGuide/1.0 (outage reporting prototype)' }, signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error('Location lookup unavailable. Please try again or provide latitude/longitude.');
          const results = await response.json() as { lat: string; lon: string; display_name: string }[];
          const result = { matches: results.map(result => ({ latitude: Number(result.lat), longitude: Number(result.lon), label: result.display_name })), attribution: '© OpenStreetMap contributors' };
          if (geocodeCache.size >= 100) geocodeCache.clear();
          geocodeCache.set(key, result);
          return result;
        });
        geocodeQueue = lookup.catch(() => {});
        return lookup;
      }),
    }),
    findNearbyOutages: tool({
      description: 'Find community outage reports within a radius of coordinates. Defaults to active reports within 25 km. Workers may include resolved reports.',
      inputSchema: jsonSchema<Coordinates & { radiusKm?: number; includeResolved?: boolean }>({ type: 'object', properties: { ...coordinates, radiusKm: { type: 'number', exclusiveMinimum: 0, maximum: 200 }, ...(worker ? { includeResolved: { type: 'boolean' } } : {}) }, required: ['latitude', 'longitude'], additionalProperties: false }),
      execute: ({ latitude, longitude, radiusKm, includeResolved }) => safe(() => store.nearby({ latitude, longitude }, radiusKm, worker && includeResolved)),
    }),
    reportOutage: tool({
      description: 'Persist an outage report ONLY after the user confirms the location and wants to submit it. Never invent coordinates or details.',
      inputSchema: jsonSchema<Coordinates & { locationLabel: string; description: string }>({ type: 'object', properties: { ...coordinates, locationLabel: { type: 'string', minLength: 1, maxLength: 500 }, description: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['latitude', 'longitude', 'locationLabel', 'description'], additionalProperties: false }),
      execute: input => safe(() => store.report(input)),
    }),
    ...(worker ? {
      resolveOutage: tool({
        description: 'Mark a report as resolved. First look up reports and ask the worker to confirm the specific report ID and that power is restored.',
        inputSchema: jsonSchema<{ id: string }>({ type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['id'], additionalProperties: false }),
        execute: ({ id }) => safe(() => store.resolve(id)),
      }),
    } : {}),
  };
}
