import { expect, it } from 'vitest';
import { vitalEvents, anniversaryEvents } from './familyDates';
import { selectMaterials } from './materials';
import type { ArchiveData } from './api';
import { eventSpan } from './eventDates';
const data: ArchiveData = {
  people: [
    { id: 'p', given_name: 'Анна', birth_date: '29.02.1980', death_date: '2020-05-10', alive: false },
    { id: 'living', given_name: 'Иван', birth_date: '2001-11-22' },
    { id: 'partial', given_name: 'Мария', birth_date: '1940' },
  ],
  relationships: [],
  media: [],
  tags: [],
  texts: [],
  text_links: [],
  sources: [],
  facts: [],
  events: [],
};
it('preserves coordinates and never turns approximate imported dates into exact anniversaries', () => {
  const d = structuredClone(data);
  d.people = [
    {
      id: 'exact',
      given_name: 'Анна',
      birth_date: '1950-03-02',
      birth_place: 'Село',
      birth_latitude: 55.1,
      birth_longitude: 47.2,
    },
    { id: 'approximate', given_name: 'Иван', birth_date: 'около 1950-03-02', birth_date_uncertain: true },
  ];
  const events = vitalEvents(d);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ latitude: 55.1, longitude: 47.2, place: 'Село' });
  expect(anniversaryEvents(d, 2026).map((e) => e.source_person_id)).toEqual(['exact']);
  expect(eventSpan({ id: 'unknown-date', date_text: 'BEF 1900', date_uncertain: true })).toBeNull();
});
it('includes original birth/death dates and annual birthday, jubilee and death memorial', () => {
  expect(vitalEvents(data).map((e) => e.start_date)).toEqual([
    '1980-02-29',
    '2020-05-10',
    '2001-11-22',
    '1940',
  ]);
  const dates = anniversaryEvents(data, 2026);
  expect(dates.find((e) => e.source_person_id === 'living')).toMatchObject({
    jubilee: true,
    anniversary_years: 25,
    start_date: '2026-11-22',
  });
  expect(dates.find((e) => e.anniversary_kind === 'memorial')).toMatchObject({
    anniversary_years: 6,
    start_date: '2026-05-10',
  });
  expect(dates.find((e) => e.source_person_id === 'p' && e.vital_kind === 'birth')?.title).toContain(
    'со дня рождения',
  );
  expect(anniversaryEvents(data, 1900)).toHaveLength(0);
});
it('handles February 29 explicitly and keeps unknown months and days out of daily cells', () => {
  expect(
    anniversaryEvents(data, 2026).find((e) => e.vital_kind === 'birth' && e.source_person_id === 'p'),
  ).toMatchObject({ start_date: '2026-02-28', description: expect.stringContaining('28 февраля') });
  expect(
    anniversaryEvents(data, 2028).find((e) => e.vital_kind === 'birth' && e.source_person_id === 'p')
      ?.start_date,
  ).toBe('2028-02-29');
  expect(
    selectMaterials(data, { kind: 'date', value: '2026-11-22' }).events.map((e) => e.source_person_id),
  ).toEqual(['living']);
  expect(
    selectMaterials(data, { kind: 'date', value: '2026-11' }).events.some(
      (e) => e.source_person_id === 'partial',
    ),
  ).toBe(true);
});
it('includes weddings until the relationship ends and leaves source records unchanged', () => {
  const d = structuredClone(data);
  d.relationships = [
    {
      id: 'r',
      kind: 'partner',
      from_id: 'p',
      to_id: 'living',
      start_date: '2010-06-03',
      end_date: '2019-01-01',
    },
  ];
  const before = JSON.stringify(d);
  expect(anniversaryEvents(d, 2015).find((e) => e.anniversary_kind === 'wedding')).toMatchObject({
    jubilee: true,
    anniversary_years: 5,
  });
  expect(anniversaryEvents(d, 2026).some((e) => e.anniversary_kind === 'wedding')).toBe(false);
  expect(JSON.stringify(d)).toBe(before);
});
it('includes scanned documents by date and place without mixing them into photo albums', () => {
  const d = structuredClone(data);
  d.media = [
    {
      id: 'scan',
      kind: 'document',
      mime: 'image/jpeg',
      title: 'Свидетельство',
      date: '2026-11-22',
      place: 'Село',
    },
    { id: 'photo', kind: 'photo', mime: 'image/jpeg', title: 'Фото', date: '2026-11-22', place: 'Село' },
  ];
  for (const selection of [
    { kind: 'date' as const, value: '2026-11-22' },
    { kind: 'place' as const, key: 'name:село', title: 'Село' },
  ]) {
    const result = selectMaterials(d, selection);
    expect(result.photos.map((m) => m.id)).toEqual(['photo']);
    expect(result.documents.map((m) => m.id)).toEqual(['scan']);
  }
});
it('uses a profile portrait to illustrate a birthday without assigning that date or place to the photo', () => {
  const d = structuredClone(data);
  d.people[1].avatar_id = 'portrait';
  d.people[1].birth_place = 'Село';
  d.media = [
    {
      id: 'portrait',
      kind: 'photo',
      title: 'Портрет',
      mime: 'image/jpeg',
      date: '2020-03-03',
      place: 'Город',
    },
  ];
  const day = selectMaterials(d, { kind: 'date', value: '2026-11-22' });
  expect(day.events[0].cover_media_id).toBe('portrait');
  expect(day.photos).toHaveLength(0);
  expect(selectMaterials(d, { kind: 'place', key: 'name:село', title: 'Село' }).photos).toHaveLength(0);
  expect(selectMaterials(d, { kind: 'date', value: '2020-03-03' }).photos).toHaveLength(1);
});
