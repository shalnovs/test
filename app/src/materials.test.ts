import { expect, it } from 'vitest';
import type { ArchiveData } from './api';
import { dateSelection, materialPlaces, selectMaterials, placeSelection, mediaSpan } from './materials';
import { eventPoint, placeKey } from './placeData';
const data = (): ArchiveData => ({
  people: [{ id: 'p', given_name: 'Анна' }],
  relationships: [],
  tags: [{ id: 't', media_id: 'exact', person_id: 'p' }],
  texts: [],
  text_links: [],
  sources: [],
  facts: [],
  events: [
    {
      id: 'event',
      title: 'Встреча',
      start_date: '2024-02-28',
      end_date: '2024-03-02',
      place: 'Чебоксары',
      person_ids: ['p'],
      media_ids: ['linked', 'exact'],
    },
  ],
  media: [
    {
      id: 'exact',
      kind: 'photo',
      title: 'Снимок дня',
      date: '2024-02-29',
      date_precision: 'day',
      place: 'Чебоксары',
    },
    { id: 'year', kind: 'photo', title: 'Только год', date: '2024', date_precision: 'year' },
    { id: 'linked', kind: 'photo', title: 'Снимок встречи' },
    { id: 'later', kind: 'photo', title: 'Другой день', date: '2024-03-10', place: 'Москва' },
  ],
});
it('combines dated photos with event attachments, without duplicates or invented days', () => {
  const d = data(),
    day = selectMaterials(d, { kind: 'date', value: '2024-02-29' });
  expect(day.events.map((e) => e.id)).toEqual(['event']);
  expect(day.photos.map((m) => m.id).sort()).toEqual(['exact', 'linked']);
  expect(
    selectMaterials(d, { kind: 'date', value: '2024-03-02' })
      .photos.map((m) => m.id)
      .sort(),
  ).toEqual(['exact', 'linked']);
  expect(selectMaterials(d, { kind: 'date', value: '2024-03-03' }).photos).toHaveLength(0);
  expect(
    selectMaterials(d, { kind: 'date', value: '2024-02' })
      .photos.map((m) => m.id)
      .sort(),
  ).toEqual(['exact', 'linked', 'year']);
});
it('uses the entire selected event period, including its last day', () => {
  const d = data();
  d.events![0].end_date = '2024-03-10';
  const selection = dateSelection(d.events![0], true)!;
  expect(selectMaterials(d, selection).photos.map((m) => m.id)).toContain('later');
  expect(mediaSpan({ id: 'old', date: '25.03.1953 г.' })?.start).toBe('1953-03-25');
});
it('groups a named city, selected city coordinates and event photographs into one place', () => {
  const d = data(),
    point = eventPoint(d.events![0])!;
  d.media.push({
    id: 'coords',
    kind: 'photo',
    title: 'Снимок с точкой',
    latitude: point.lat,
    longitude: point.lon,
  });
  const group = materialPlaces(d).find((g) => g.title === 'Чебоксары')!;
  expect(group.events).toHaveLength(1);
  expect(group.photos.map((m) => m.id).sort()).toEqual(['coords', 'exact', 'linked']);
  expect(group.point?.id).toBe(placeKey(d.events![0]));
  expect(selectMaterials(d, placeSelection(d.media[0])!).photos).toHaveLength(3);
});
it('does not combine different coordinates merely because their place names match', () => {
  const d = data();
  d.media.push({
    id: 'distant',
    kind: 'photo',
    title: 'Тёзка города',
    place: 'Чебоксары',
    latitude: 0,
    longitude: 0,
  });
  expect(materialPlaces(d).filter((g) => g.title === 'Чебоксары')).toHaveLength(2);
  d.media.push({ id: 'unknown', kind: 'photo', title: 'Деревня', place: 'Деревня без координат' });
  expect(materialPlaces(d).find((g) => g.title === 'Деревня без координат')?.point).toBeNull();
});
it('respects people and search filters, including photographs linked through an event', () => {
  const d = data();
  expect(
    selectMaterials(d, { kind: 'date', value: '2024-02-29', personId: 'p', query: 'Встреча' })
      .photos.map((m) => m.id)
      .sort(),
  ).toEqual(['exact', 'linked']);
  expect(selectMaterials(d, { kind: 'date', value: '2024-02-29', personId: 'absent' }).photos).toHaveLength(
    0,
  );
  expect(
    materialPlaces(d, 'Снимок дня')
      .flatMap((g) => g.photos)
      .map((m) => m.id),
  ).toEqual(['exact']);
});
