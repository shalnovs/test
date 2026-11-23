import places from './map-data/places.json';
import { searchWords } from './nameMatching';
import type { Item } from './api';

export type MapPoint = { id: string; lat: number; lon: number; title: string; approximate?: boolean };
const indexedPlaces = places.map((place) => ({ place, words: searchWords(`${place.name} ${place.other}`) }));
const placeIndex = new Map<string, typeof places>();
places.forEach((place) => {
  for (const name of new Set([place.name, place.other].map((n) => searchWords(n).join(' '))))
    placeIndex.set(name, [...(placeIndex.get(name) || []), place]);
});
export function findPlaces(query: string) {
  const tokens = searchWords(query);
  return !tokens.length
    ? []
    : indexedPlaces
        .filter((p) => tokens.every((t) => p.words.some((w) => w.startsWith(t))))
        .slice(0, 12)
        .map((p) => p.place);
}
export function eventPoint(e: Item): MapPoint | null {
  if (
    typeof e.latitude === 'number' &&
    typeof e.longitude === 'number' &&
    Math.abs(e.latitude) <= 90 &&
    Math.abs(e.longitude) <= 180
  )
    return {
      id: e.id,
      title: e.title,
      lat: e.latitude,
      lon: e.longitude,
      approximate: ['city', 'settlement'].includes(e.location_precision),
    };
  const names = searchWords(e.place || '').join(' ');
  const exact = placeIndex.get(names) || [];
  return exact.length === 1
    ? { id: e.id, title: e.title, lat: exact[0].lat, lon: exact[0].lon, approximate: true }
    : null;
}

export function placeKey(record: Item): string {
  const point = eventPoint(record);
  if (point) return `point:${point.lat.toFixed(5)}:${point.lon.toFixed(5)}`;
  const name = searchWords(record.place || '').join(' ');
  return name ? `name:${name}` : '';
}
