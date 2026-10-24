import { describe, expect, test } from 'bun:test';
import { createOutageStore, distanceKm } from './outages';

describe('outage reports', () => {
  test('report, find nearby, resolve, and retain resolved reports for workers', () => {
    const store = createOutageStore(':memory:');
    try {
      const location = { latitude: 39.96, longitude: -83 };
      const report = store.report({ ...location, locationLabel: 'Columbus, Ohio', description: 'Power out on our block' });
      store.report({ latitude: 40.71, longitude: -74, locationLabel: 'New York', description: 'Power out' });
      expect(store.nearby(location).outages.map(row => row.id)).toEqual([report.id]);
      expect(store.resolve(report.id)).toMatchObject({ outage: { status: 'resolved' }, alreadyResolved: false });
      expect(store.nearby(location).total).toBe(0);
      expect(store.nearby(location, 25, true).outages[0]?.resolvedAt).toBeTruthy();
      expect(store.resolve(report.id)).toMatchObject({ alreadyResolved: true });
      expect(store.resolve('missing')).toHaveProperty('error');
    } finally { store.close(); }
  });
  test('validates inputs and calculates distances across the date line', () => {
    const store = createOutageStore(':memory:');
    try {
      expect(() => store.report({ latitude: 91, longitude: 0, locationLabel: 'Invalid', description: 'Outage' })).toThrow();
      expect(() => store.nearby({ latitude: 0, longitude: NaN })).toThrow();
      expect(() => store.nearby({ latitude: 0, longitude: 0 }, 201)).toThrow();
      expect(distanceKm({ latitude: 0, longitude: 179.99 }, { latitude: 0, longitude: -179.99 })).toBeLessThan(3);
      store.report({ latitude: 0, longitude: -179.99, locationLabel: 'Date line', description: 'Outage' });
      expect(store.nearby({ latitude: 0, longitude: 179.99 }).total).toBe(1);
    } finally { store.close(); }
  });
});
