// Optional: Google Places API (New) text search. Off unless a key is set + flag on.
// Privacy: we send ONLY a text query like "thai restaurant vegetarian Midtown" —
// never your coordinates or location history.
import type { Restaurant } from '@engine/dining';
import type { NearbyPlace } from '@engine/meals';

const PRICE: Record<string, number> = { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 12, PRICE_LEVEL_MODERATE: 25, PRICE_LEVEL_EXPENSIVE: 45, PRICE_LEVEL_VERY_EXPENSIVE: 80 };

export async function searchRestaurants(apiKey: string, textQuery: string): Promise<Restaurant[]> {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.priceLevel,places.rating,places.googleMapsUri,places.websiteUri,places.servesVegetarianFood,places.types,places.reservable',
    },
    body: JSON.stringify({ textQuery, maxResultCount: 10 }),
  });
  if (!r.ok) throw new Error(`Places API ${r.status}`);
  const data = await r.json();
  return (data.places ?? []).map((p: any): Restaurant => ({
    id: p.id, name: p.displayName?.text ?? 'Restaurant',
    cuisines: (p.types ?? []).filter((t: string) => t.endsWith('_restaurant') && t !== 'restaurant').map((t: string) => t.replace('_restaurant', '').replace(/_/g, ' ')),
    pricePerPerson: p.priceLevel ? PRICE[p.priceLevel] : undefined,
    diets: p.servesVegetarianFood ? ['vegetarian'] : [], dietInfoKnown: p.servesVegetarianFood !== undefined,
    url: p.websiteUri, mapsUrl: p.googleMapsUri, rating: p.rating, reservable: p.reservable, source: 'places-api',
  }));
}

export async function nearbyQuick(apiKey: string, cuisine: string, area: string): Promise<NearbyPlace[]> {
  const list = await searchRestaurants(apiKey, `quick ${cuisine} takeout ${area}`);
  // travel time is unknown without sending coordinates; assume walkable-ish and say so in UI
  return list.slice(0, 4).map(r => ({ name: r.name, cuisine: r.cuisines[0], travelMin: 10, priceLevel: r.pricePerPerson ? r.pricePerPerson / 10 : undefined, url: r.url, mapsUrl: r.mapsUrl, servesVegetarian: r.dietInfoKnown ? r.diets?.includes('vegetarian') : undefined, source: 'places-api' }));
}
