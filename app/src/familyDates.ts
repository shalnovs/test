import { fullName, type ArchiveData, type Item } from './api';
import { dateSpan, historicalDate, type DateSpan } from './eventDates';
const value = (d: DateSpan) => d.start.slice(0, d.precision === 'day' ? 10 : d.precision === 'month' ? 7 : 4);
const yearsText = (n: number) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'год' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'года' : 'лет'}`;
export function vitalEvents(data: ArchiveData): Item[] {
  const result: Item[] = [];
  for (const p of data.people) {
    const cover = data.media.some((m) => m.id === p.avatar_id) ? p.avatar_id : '';
    for (const [kind, raw, place, label] of [
      ['birth', p.birth_date, p.birth_place, 'Рождение'],
      ['death', p.death_date, p.death_place, 'Смерть'],
    ]) {
      if (p[`${kind}_date_uncertain`]) continue;
      const d = historicalDate(raw || '');
      if (!d) continue;
      result.push({
        id: `vital-${kind}:${p.id}`,
        title: `${label}: ${fullName(p)}`,
        description:
          kind === 'birth' ? 'Дата рождения из карточки человека.' : 'Дата смерти из карточки человека.',
        start_date: value(d),
        end_date: '',
        place: place || '',
        latitude: p[`${kind}_latitude`],
        longitude: p[`${kind}_longitude`],
        person_ids: [p.id],
        media_ids: [],
        cover_media_id: cover,
        cover_is_portrait: true,
        generated: true,
        vital_kind: kind,
        source_person_id: p.id,
        origin_date: value(d),
      });
    }
  }
  for (const r of data.relationships.filter((r) => r.kind === 'partner')) {
    if (r.date_uncertain) continue;
    const d = historicalDate(r.start_date || '');
    if (!d) continue;
    const people = [r.from_id, r.to_id].filter((id) => data.people.some((p) => p.id === id));
    result.push({
      id: `vital-marriage:${r.id}`,
      title: `Брак: ${people.map((id) => fullName(data.people.find((p) => p.id === id))).join(' и ')}`,
      description: 'Дата брака из родственных связей.',
      start_date: value(d),
      end_date: '',
      place: r.place || '',
      latitude: r.latitude,
      longitude: r.longitude,
      person_ids: people,
      media_ids: [],
      generated: true,
      vital_kind: 'marriage',
      source_person_id: people[0],
      origin_date: value(d),
      relationship_end: r.end_date || '',
    });
  }
  return result;
}
export function anniversaryEvents(data: ArchiveData, startYear: number, endYear = startYear): Item[] {
  const result: Item[] = [];
  for (const original of vitalEvents(data)) {
    const source = historicalDate(original.origin_date)!;
    const born = +source.start.slice(0, 4),
      p = data.people.find((p) => p.id === original.source_person_id);
    for (let year = Math.max(startYear, born + 1); year <= Math.min(endYear, 9999); year++) {
      let date = `${String(year).padStart(4, '0')}${value(source).slice(4)}`,
        note = '';
      if (date.endsWith('-02-29') && !dateSpan(date)) {
        date = date.slice(0, 8) + '28';
        note = 'Дата в карточке — 29 февраля. В невисокосном году напоминание показано 28 февраля.';
      }
      const actual = dateSpan(date);
      if (!actual) continue;
      const age = year - born,
        jubilee = age >= 5 && age % 5 === 0;
      const death = historicalDate(p?.death_date || '');
      let title: string, kind: string;
      if (original.vital_kind === 'birth') {
        const memorial = p?.alive === false || (!!death && death.start <= actual.end);
        title = memorial
          ? `${yearsText(age)} со дня рождения: ${fullName(p)}`
          : `${jubilee ? 'Юбилей' : 'День рождения'} — ${yearsText(age)}: ${fullName(p)}`;
        kind = jubilee ? 'jubilee' : 'birthday';
      } else if (original.vital_kind === 'death') {
        title = `Годовщина смерти — ${yearsText(age)}: ${fullName(p)}`;
        kind = 'memorial';
      } else {
        const end = historicalDate(original.relationship_end || '');
        if (end && actual.start > end.end) continue;
        title = `${jubilee ? 'Юбилей свадьбы' : 'Годовщина свадьбы'} — ${yearsText(age)}: ${original.person_ids.map((id: string) => fullName(data.people.find((p) => p.id === id))).join(' и ')}`;
        kind = 'wedding';
      }
      result.push({
        ...original,
        id: `${original.id}@${year}`,
        title,
        start_date: date,
        description: `${original.description} ${note}`.trim(),
        anniversary: true,
        anniversary_kind: kind,
        anniversary_years: age,
        jubilee,
      });
    }
  }
  return result;
}
