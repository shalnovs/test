import { describe, expect, it } from 'vitest';
import { dateSpan, historicalDate, eventSpan, intersects, monthDays } from './eventDates';
import { familyEvents } from './eventData';
import { personMatches } from './nameMatching';
import type { ArchiveData } from './api';

describe('dates without invented precision', () => {
  it('validates leap days and chronological bounds', () => {
    expect(dateSpan('2024-02-29')?.end).toBe('2024-02-29');
    expect(dateSpan('1900-02-29')).toBeNull();
    expect(dateSpan('2024-13')).toBeNull();
    expect(dateSpan('0004-02')?.end).toBe('0004-02-29');
    expect(dateSpan('1947')).toEqual({ start: '1947-01-01', end: '1947-12-31', precision: 'year' });
  });
  it('reads Russian dates with their original level of precision', () => {
    expect(historicalDate('Январь 1947 г.')).toEqual({
      start: '1947-01-01',
      end: '1947-01-31',
      precision: 'month',
    });
    expect(historicalDate('25 Март 1953 г.')?.start).toBe('1953-03-25');
    expect(historicalDate('Весна 1994 год. Прыжок на северный полюс')?.precision).toBe('year');
    expect(historicalDate('25.03.1953 г.')?.start).toBe('1953-03-25');
    expect(historicalDate('1950–1952')).toBeNull();
    expect(historicalDate('2023-02-30')).toBeNull();
    expect(historicalDate('дата неизвестна')).toBeNull();
  });
  it('includes long events in each intersecting month and builds a Monday-first grid', () => {
    const event = eventSpan({ start_date: '2024-01-31', end_date: '2024-03-02' })!;
    expect(intersects(event, dateSpan('2024-02')!)).toBe(true);
    expect(intersects(event, dateSpan('2024-04')!)).toBe(false);
    expect(monthDays('2024-02')[0]).toBe('2024-01-29');
    expect(monthDays('2024-02')).toContain('2024-02-29');
    expect(monthDays('2024-02')).toHaveLength(42);
  });
});

it('shows legacy facts without writing or duplicating edited or hidden events', () => {
  const data: ArchiveData = {
    people: [],
    media: [],
    tags: [],
    relationships: [],
    texts: [],
    text_links: [],
    sources: [],
    facts: [
      {
        id: 'f',
        person_id: 'p',
        title: 'МестаПроживания',
        place: 'Чебоксары',
        value: { ДатаНачало: null, ДатаКонец: null },
      },
      { id: 'a', person_id: 'p', kind: 'alternative', title: 'Alternative', value: 'unconfirmed' },
    ],
  };
  const before = JSON.stringify(data);
  expect(familyEvents(data)).toHaveLength(1);
  expect(familyEvents(data)[0]).toMatchObject({
    title: 'Проживание: Чебоксары',
    start_date: '',
    person_ids: ['p'],
  });
  expect(JSON.stringify(data)).toBe(before);
  data.events = [{ id: 'legacy-f', title: 'Уточнённое событие', person_ids: ['p'], media_ids: [] }];
  expect(familyEvents(data).map((e) => e.title)).toEqual(['Уточнённое событие']);
  data.events[0].hidden = true;
  expect(familyEvents(data)).toEqual([]);
});

it('matches name prefixes in any order across all name fields, including ё and hyphens', () => {
  const p = {
    surname: 'Петрова-Сидорова',
    given_name: 'Анна',
    patronymic: 'Павловна',
    birth_surname: 'Ёлкина',
    second_surname: 'Иванова',
  };
  for (const query of ['ан', 'пав', 'ел', 'иван', 'сид ан', 'Ан Петр', 'Павл Ан Ив'])
    expect(personMatches(p, query)).toBe(true);
  for (const query of ['рова', 'Иван Мих', 'Миха']) expect(personMatches(p, query)).toBe(false);
});
