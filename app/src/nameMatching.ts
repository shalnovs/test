import type { Item } from './api';
export const searchWords = (value: string) =>
  value
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .split(/[\s,;()\-–—]+/)
    .filter(Boolean);
export function personMatches(person: Partial<Item>, query: string) {
  const names = [
    person.surname,
    person.given_name,
    person.patronymic,
    person.birth_surname,
    person.second_surname,
  ].flatMap((v) => searchWords(String(v || '')));
  return searchWords(query).every((prefix) => names.some((word) => word.startsWith(prefix)));
}
