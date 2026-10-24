import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Coordinates = { latitude: number; longitude: number };
export function validateCoordinates(location: Coordinates) {
  if (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90 || !Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180) {
    throw new Error('Invalid latitude or longitude.');
  }
}
export function distanceKm(a: Coordinates, b: Coordinates) {
  const radians = (n: number) => n * Math.PI / 180;
  const d = Math.sin(radians(b.latitude - a.latitude) / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(d), Math.sqrt(Math.max(0, 1 - d)));
}
type Outage = Coordinates & { id: string; description: string; locationLabel: string; status: 'active' | 'resolved'; createdAt: string; resolvedAt: string | null };
export function createOutageStore(path = process.env.DATABASE_PATH || './data/outages.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS outages (
      id TEXT PRIMARY KEY, latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
      longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
      locationLabel TEXT NOT NULL, description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'resolved')),
      createdAt TEXT NOT NULL, resolvedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS outages_status_location ON outages(status, latitude, longitude);`);
  return {
    close: () => db.close(),
    report(input: Coordinates & { locationLabel: string; description: string }) {
      validateCoordinates(input);
      if (!input.locationLabel.trim() || input.locationLabel.length > 500 || !input.description.trim() || input.description.length > 2000) throw new Error('Provide a location label (up to 500 characters) and description (up to 2000 characters).');
      const outage: Outage = { ...input, id: crypto.randomUUID(), status: 'active', createdAt: new Date().toISOString(), resolvedAt: null };
      db.query('INSERT INTO outages (id, latitude, longitude, locationLabel, description, status, createdAt) VALUES ($id, $latitude, $longitude, $locationLabel, $description, $status, $createdAt)').run({ $id: outage.id, $latitude: outage.latitude, $longitude: outage.longitude, $locationLabel: outage.locationLabel, $description: outage.description, $status: outage.status, $createdAt: outage.createdAt });
      return outage;
    },
    nearby(location: Coordinates, radiusKm = 25, includeResolved = false) {
      validateCoordinates(location);
      if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 200) throw new Error('Radius must be between 0 and 200 km.');
      const latitudeDelta = radiusKm / 110;
      const rows = db.query<Outage, [number, number, number]>('SELECT * FROM outages WHERE (? = 1 OR status = \'active\') AND latitude BETWEEN ? AND ?').all(Number(includeResolved), location.latitude - latitudeDelta, location.latitude + latitudeDelta);
      const matches = rows.map(row => ({ ...row, distanceKm: distanceKm(location, row) })).filter(row => row.distanceKm <= radiusKm).sort((a, b) => a.distanceKm - b.distanceKm);
      return { outages: matches.slice(0, 100), total: matches.length, radiusKm, source: 'Community reports; not verified utility data' };
    },
    resolve(id: string) {
      const outage = db.query<Outage, [string]>('SELECT * FROM outages WHERE id = ?').get(id);
      if (!outage) return { error: 'Outage not found. Check the report ID.' };
      if (outage.status === 'resolved') return { outage, alreadyResolved: true };
      db.query('UPDATE outages SET status = \'resolved\', resolvedAt = ? WHERE id = ?').run(new Date().toISOString(), id);
      return { outage: db.query<Outage, [string]>('SELECT * FROM outages WHERE id = ?').get(id), alreadyResolved: false };
    },
  };
}
