import { expect, it } from 'vitest';
import { siblingsAndCousins, familySelection, familyLevels } from './kinship';
import type { ArchiveData } from './api';
const blank = (): ArchiveData => ({
  people: [],
  relationships: [],
  media: [],
  tags: [],
  texts: [],
  text_links: [],
  sources: [],
  facts: [],
});
function edge(d: ArchiveData, a: string, b: string, kind = 'parent') {
  for (const id of [a, b]) if (!d.people.some((p) => p.id === id)) d.people.push({ id, given_name: id });
  d.relationships.push({ id: `${a}-${b}`, from_id: a, to_id: b, kind });
}
it('distinguishes full, half, uncertain and step siblings without inventing a missing parent', () => {
  const d = blank();
  for (const child of ['root', 'full', 'half', 'unknown']) edge(d, 'mother', child);
  edge(d, 'father', 'root');
  edge(d, 'father', 'full');
  edge(d, 'other', 'half');
  edge(d, 'stepfather', 'step');
  edge(d, 'mother', 'stepfather', 'partner');
  edge(d, 'root', 'child');
  const rel = siblingsAndCousins(d, 'root');
  expect(Object.fromEntries(rel.map((r) => [r.person.id, r.kind]))).toEqual({
    full: 'full',
    half: 'half',
    unknown: 'shared',
    step: 'step',
  });
  const near = familySelection(d, 'root', 'family', false);
  expect(near.has('child')).toBe(true);
  expect(near.has('full')).toBe(true);
  expect(familyLevels(d, 'root', false).get('father')).toBe(-1);
});
it('finds cousins through several generations and includes the paths that explain the relationship', () => {
  const d = blank();
  edge(d, 'parent', 'root');
  edge(d, 'grand', 'parent');
  edge(d, 'grand', 'aunt');
  edge(d, 'aunt', 'cousin');
  edge(d, 'great', 'grand');
  edge(d, 'great', 'gAunt');
  edge(d, 'gAunt', 'secondParent');
  edge(d, 'secondParent', 'second');
  edge(d, 'gg', 'great');
  edge(d, 'gg', 'ggAunt');
  edge(d, 'ggAunt', 'thirdGrand');
  edge(d, 'thirdGrand', 'thirdParent');
  edge(d, 'thirdParent', 'third');
  const r = siblingsAndCousins(d, 'root');
  expect(r.map((v) => [v.person.id, v.degree])).toEqual([
    ['cousin', 1],
    ['second', 2],
    ['third', 3],
  ]);
  const visible = familySelection(d, 'root', 'family', true);
  expect(visible.has('gg')).toBe(true);
  expect(visible.has('third')).toBe(true);
  expect(familySelection(d, 'root', 'family', false).has('cousin')).toBe(false);
  expect(familyLevels(d, 'root', true).get('gg')).toBe(-4);
});
it('keeps everyone in the full family view and changes the family around the chosen center', () => {
  const d = blank();
  edge(d, 'grand', 'parent');
  edge(d, 'parent', 'root');
  edge(d, 'root', 'child');
  d.people.push({ id: 'unrelated', given_name: 'Другой' });
  expect(familySelection(d, 'root', 'all', false).size).toBe(5);
  expect(familySelection(d, 'child', 'family', false).has('grand')).toBe(false);
  expect(familySelection(d, 'root', 'ancestors', false)).toEqual(new Set(['root', 'parent', 'grand']));
});
