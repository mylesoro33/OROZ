import type { Place, TravelTime, LocationTag, ID } from './types';

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Which named place contains these coordinates (closest wins). */
export function detectPlace(lat: number, lng: number, places: Place[], accuracyM = 0): Place | undefined {
  let best: Place | undefined, bestD = Infinity;
  for (const p of places) {
    const d = haversineM(lat, lng, p.lat, p.lng);
    if (d <= p.radiusM + Math.min(accuracyM, 150) && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/** Travel minutes between places: table lookup (either direction), else distance estimate (~25 km/h urban + 5 min overhead). */
export function travelMinutes(from: ID | undefined, to: ID | undefined, table: TravelTime[], places: Place[] = []): number {
  if (!from || !to || from === to) return 0;
  const hit = table.find(t => (t.from === from && t.to === to) || (t.from === to && t.to === from));
  if (hit) return hit.minutes;
  const a = places.find(p => p.id === from), b = places.find(p => p.id === to);
  if (!a || !b) return 15;
  const km = haversineM(a.lat, a.lng, b.lat, b.lng) / 1000;
  return Math.round(5 + (km / 25) * 60);
}

/** Resolve a location tag to the place where it must happen (undefined = anywhere). */
export function placeForTag(tag: LocationTag | undefined, places: Place[], current?: ID): ID | undefined {
  if (!tag || tag === 'anywhere' || tag === 'outside') return undefined;
  if (current) {
    const cur = places.find(p => p.id === current);
    if (cur?.tags.includes(tag)) return cur.id;
  }
  return places.find(p => p.tags.includes(tag))?.id;
}

export function canDoAt(tag: LocationTag | undefined, place: Place | undefined): boolean {
  if (!tag || tag === 'anywhere') return true;
  if (!place) return tag === 'outside';
  return place.tags.includes(tag);
}
