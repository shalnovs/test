import { dateLabel, fullName, type ArchiveData, type Item } from './api';
import { familyEvents, eventsForRange } from './eventData';
import { dateSpan, historicalDate, eventSpan, intersects, type DateSpan } from './eventDates';
import { eventPoint, placeKey, type MapPoint } from './placeData';

export type MaterialSelection = (
  | { kind: 'date'; value: string; end?: string }
  | { kind: 'place'; key: string; title: string }
) & { personId?: string; query?: string };
export const isPhoto = (m: Item) =>
  m.kind === 'document' ? false : m.kind === 'photo' || !!m.mime?.startsWith('image/');
export const mediaSpan = (m: Item) => historicalDate(m.date || '');
export const spanValue = (span: DateSpan) =>
  span.start.slice(0, span.precision === 'day' ? 10 : span.precision === 'month' ? 7 : 4);
export function mediaDateLabel(m: Item) {
  const span = mediaSpan(m);
  return span ? dateLabel(spanValue(span)) : m.date || 'Дата не указана';
}
export function dateSelection(record: Item, event = false): MaterialSelection | null {
  const span = event ? eventSpan(record) : mediaSpan(record);
  return span
    ? { kind: 'date', value: spanValue(span), ...(event && record.end_date ? { end: record.end_date } : {}) }
    : null;
}
export function placeSelection(record: Item): MaterialSelection | null {
  const key = placeKey(record),
    point = eventPoint(record);
  return key
    ? { kind: 'place', key, title: record.place || `${point!.lat.toFixed(5)}, ${point!.lon.toFixed(5)}` }
    : null;
}
export function selectionRange(selection: MaterialSelection): DateSpan | null {
  if (selection.kind !== 'date') return null;
  const start = dateSpan(selection.value),
    end = dateSpan(selection.end || '');
  return start ? { ...start, end: end?.end || start.end } : null;
}
export function selectionTitle(selection: MaterialSelection) {
  return selection.kind === 'place'
    ? selection.title
    : `${dateLabel(selection.value)}${selection.end ? ' — ' + dateLabel(selection.end) : ''}`;
}
export function selectMaterials(data: ArchiveData, selection: MaterialSelection) {
  const range = selectionRange(selection),
    query = (selection.query || '').trim().toLocaleLowerCase('ru');
  const names = (ids: string[]) => ids.map((id) => fullName(data.people.find((p) => p.id === id))).join(' ');
  const includes = (record: Item, ids: string[]) =>
    !query ||
    `${record.title || ''} ${record.description || ''} ${record.comment || ''} ${record.place || ''} ${names(ids)}`
      .toLocaleLowerCase('ru')
      .includes(query);
  const matches = (record: Item, event: boolean) => {
    if (selection.kind === 'place') return placeKey(record) === selection.key;
    const span = event ? eventSpan(record) : mediaSpan(record);
    return (
      !!span && !!range && intersects(span, range) && (range.precision !== 'day' || span.precision === 'day')
    );
  };
  const events = eventsForRange(data, range).filter(
    (e) =>
      (!selection.personId || e.person_ids?.includes(selection.personId)) &&
      includes(e, e.person_ids || []) &&
      matches(e, true),
  );
  const linked = new Set(
    events.flatMap((e) =>
      [...(e.media_ids || []), e.cover_is_portrait ? '' : e.cover_media_id].filter(Boolean),
    ),
  );
  const materials = data.media.filter((m) => {
    if (linked.has(m.id)) return true;
    if (!matches(m, false)) return false;
    if (!selection.personId && !query) return true;
    const people = [
      ...data.tags.filter((t) => t.media_id === m.id).map((t) => t.person_id),
      ...data.people.filter((p) => p.avatar_id === m.id).map((p) => p.id),
    ];
    return (!selection.personId || people.includes(selection.personId)) && includes(m, people);
  });
  events.sort(
    (a, b) =>
      (eventSpan(a)?.start || '').localeCompare(eventSpan(b)?.start || '') ||
      a.title.localeCompare(b.title, 'ru'),
  );
  materials.sort(
    (a, b) =>
      (mediaSpan(a)?.start || '').localeCompare(mediaSpan(b)?.start || '') ||
      a.title.localeCompare(b.title, 'ru'),
  );
  return {
    events,
    photos: materials.filter(isPhoto),
    documents: materials.filter((m) => !isPhoto(m)),
    linked,
  };
}
export type MaterialPlace = {
  key: string;
  title: string;
  point: MapPoint | null;
  events: Item[];
  photos: Item[];
  documents: Item[];
};
export function materialPlaces(data: ArchiveData, query = ''): MaterialPlace[] {
  const groups = new Map<string, MaterialPlace>();
  for (const record of [...familyEvents(data), ...data.media]) {
    const selection = placeSelection(record);
    if (!selection || selection.kind !== 'place' || groups.has(selection.key)) continue;
    const items = selectMaterials(data, { ...selection, query });
    if (!items.events.length && !items.photos.length && !items.documents.length) continue;
    const point = eventPoint(record);
    groups.set(selection.key, {
      key: selection.key,
      title: selection.title,
      point: point ? { ...point, id: selection.key, title: selection.title } : null,
      ...items,
    });
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}
