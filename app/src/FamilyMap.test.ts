// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { eventPoint, findPlaces } from './FamilyMap';

it('finds local cities by Russian prefixes and distinguishes city centres from event points', () => {
  expect(findPlaces('Чебок').some((p) => p.name === 'Чебоксары')).toBe(true);
  expect(findPlaces('Полтав').some((p) => p.name === 'Полтава')).toBe(true);
  expect(findPlaces('')).toEqual([]);
  const city = eventPoint({ id: 'c', title: 'Проживание', place: 'Чебоксары' });
  expect(city?.approximate).toBe(true);
  expect(city?.lat).toBeGreaterThan(55);
  expect(city?.lon).toBeLessThan(48);
  expect(eventPoint({ id: 'x', place: 'Неизвестная деревня' })).toBeNull();
  expect(eventPoint({ id: 'x', title: 'Встреча', latitude: 55, longitude: 47 })).toMatchObject({
    lat: 55,
    lon: 47,
    approximate: false,
  });
  expect(eventPoint({ id: 'x', latitude: 100, longitude: 47 })).toBeNull();
});
