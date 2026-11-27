export type DateSpan = { start: string; end: string; precision: 'day' | 'month' | 'year' };
export function dateSpan(input: string): DateSpan | null {
  const value = (input || '').trim();
  if (!value) return null;
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!m) return null;
  const year = +m[1],
    month = m[2] ? +m[2] : 1,
    day = m[3] ? +m[3] : 1;
  if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
  const endOfMonth = new Date(0);
  endOfMonth.setUTCFullYear(year, month, 0);
  const days = endOfMonth.getUTCDate();
  if (day < 1 || day > days) return null;
  const first = `${m[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    start: first,
    end: m[3] ? first : m[2] ? `${m[1]}-${m[2]}-${days}` : `${m[1]}-12-31`,
    precision: m[3] ? 'day' : m[2] ? 'month' : 'year',
  };
}
const months = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export function historicalDate(value: string): DateSpan | null {
  const exact = dateSpan(value);
  if (exact) return exact;
  if (/^\s*\d{4}-/.test(value || '')) return null;
  const numeric = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*(?:г\.?)?\s*$/.exec(value || '');
  if (numeric) return dateSpan(`${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`);
  const years = (value || '').match(/\b(?:1[0-9]{3}|20\d{2})\b/g);
  if (!years || new Set(years).size !== 1) return null;
  const words = value.toLowerCase().replaceAll('ё', 'е');
  const mi = months.findIndex((prefix) => new RegExp(`(?:^|[\\s.])${prefix}[а-я]*`, 'u').test(words));
  if (mi >= 0) {
    const day = /(?:^|\s)(\d{1,2})\s+[а-я]+\s+\d{4}/u.exec(words);
    return dateSpan(
      `${years[0]}-${String(mi + 1).padStart(2, '0')}${day ? '-' + day[1].padStart(2, '0') : ''}`,
    );
  }
  return dateSpan(years[0]);
}
export function eventSpan(event: Record<string, any>): DateSpan | null {
  if (event.date_uncertain) return null;
  const start = dateSpan(event.start_date) || historicalDate(event.date_text || '');
  if (!start) return null;
  const end = dateSpan(event.end_date);
  return { ...start, end: end?.end || start.end };
}
export function intersects(a: DateSpan, b: DateSpan) {
  return a.start <= b.end && a.end >= b.start;
}
export function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  first.setUTCFullYear(y);
  first.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}
