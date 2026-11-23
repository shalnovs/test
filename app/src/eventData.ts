import type { ArchiveData, Item } from './api';
import { vitalEvents, anniversaryEvents } from './familyDates';
import type { DateSpan } from './eventDates';
export function familyEvents(data: ArchiveData): Item[] {
  const stored = data.events || [];
  const existing = new Set(stored.map((e) => e.id));
  const legacy = data.facts
    .filter((f) => !['alternative', 'merged_record'].includes(f.kind))
    .map((f) => {
      const residence = f.title === 'МестаПроживания';
      return {
        id: `legacy-${f.id}`,
        legacy_fact_id: f.id,
        title: residence ? `Проживание: ${f.place || 'место не указано'}` : f.title || 'Событие из архива',
        description:
          typeof f.value === 'string'
            ? f.value
            : residence
              ? 'Сведения о месте проживания из исходного архива.'
              : JSON.stringify(f.value, null, 2),
        start_date: f.value?.ДатаНачало?.slice?.(0, 10) || '',
        end_date: f.value?.ДатаКонец?.slice?.(0, 10) || '',
        date_text: f.date || (!residence ? f.title : ''),
        place: f.place || '',
        person_ids: [f.person_id].filter(Boolean),
        media_ids: [],
        source_id: f.source_id,
      };
    })
    .filter((e) => !existing.has(e.id));
  return [...stored.filter((e) => !e.hidden), ...legacy, ...vitalEvents(data)];
}
export function eventsForRange(data: ArchiveData, range: DateSpan | null) {
  return [
    ...familyEvents(data),
    ...(range ? anniversaryEvents(data, +range.start.slice(0, 4), +range.end.slice(0, 4)) : []),
  ];
}
export function familyEventById(data: ArchiveData, id: string) {
  const occurrence = /@(\d{1,4})$/.exec(id);
  return (occurrence ? anniversaryEvents(data, +occurrence[1]) : familyEvents(data)).find((e) => e.id === id);
}
