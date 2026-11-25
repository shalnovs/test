import { expect, it } from 'vitest';
import type { ArchiveData } from './api';
import { treeLayout, TREE_CARD_WIDTH, TREE_CARD_HEIGHT } from './treeLayout';

const data: ArchiveData = {
  people: [
    'root',
    'father',
    'mother',
    'sister',
    'grandfather',
    'grandmother',
    'uncle',
    'cousin',
    'spouse',
    'son',
    'unlinked',
  ].map((id) => ({ id })),
  relationships: [
    ['father', 'root'],
    ['mother', 'root'],
    ['father', 'sister'],
    ['mother', 'sister'],
    ['grandfather', 'father'],
    ['grandfather', 'uncle'],
    ['uncle', 'cousin'],
    ['root', 'son'],
  ]
    .map(([from_id, to_id], i) => ({ id: `p${i}`, kind: 'parent', from_id, to_id }))
    .concat([
      { id: 'm1', kind: 'partner', from_id: 'grandfather', to_id: 'grandmother' },
      { id: 'm2', kind: 'partner', from_id: 'root', to_id: 'spouse' },
    ]),
  media: [],
  tags: [],
  texts: [],
  text_links: [],
  sources: [],
  facts: [],
};

it('lays out all generations, spouses and disconnected people without overlapping cards for every center', () => {
  const before = JSON.stringify(data);
  for (const person of data.people) {
    const layout = treeLayout(data, person.id, 'all', false);
    expect(layout.positions.size).toBe(data.people.length);
    expect(layout.positions.get(person.id)).toEqual({ x: 0, y: 0 });
    for (const r of data.relationships) {
      const from = layout.positions.get(r.from_id)!,
        to = layout.positions.get(r.to_id)!;
      if (r.kind === 'parent') expect(from.y).toBeLessThan(to.y);
      else expect(from.y).toBe(to.y);
    }
    expect(layout.positions.get('father')!.y).toBe(layout.positions.get('mother')!.y);
    for (const [id, point] of layout.positions) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      for (const [other, p] of layout.positions) {
        if (id !== other)
          expect(
            Math.abs(point.x - p.x) >= TREE_CARD_WIDTH || Math.abs(point.y - p.y) >= TREE_CARD_HEIGHT,
          ).toBe(true);
      }
    }
    expect(layout.relationships).toEqual(data.relationships);
  }
  expect(JSON.stringify(data)).toBe(before);
});

it('filters ancestors and descendants and includes actual ancestry when showing cousins', () => {
  expect(
    treeLayout(data, 'root', 'ancestors', false)
      .people.map((p) => p.id)
      .sort(),
  ).toEqual(['father', 'grandfather', 'mother', 'root']);
  expect(
    treeLayout(data, 'root', 'descendants', false)
      .people.map((p) => p.id)
      .sort(),
  ).toEqual(['root', 'son']);
  const cousins = treeLayout(data, 'root', 'all', true, 'Двоюродные');
  expect(cousins.people.map((p) => p.id).sort()).toEqual([
    'cousin',
    'father',
    'grandfather',
    'root',
    'uncle',
  ]);
  expect(cousins.relationships).toHaveLength(4);
  expect(cousins.relationships.every((r) => r.kind === 'parent')).toBe(true);
  expect(cousins.positions.get('root')!.y).toBe(cousins.positions.get('cousin')!.y);
});

it('handles empty archives, dangling references and cyclic genealogy without failing or inventing people', () => {
  expect(treeLayout({ ...data, people: [], relationships: [] }, '', 'all', false).people).toEqual([]);
  const invalid: ArchiveData = {
    ...data,
    people: [{ id: 'a' }, { id: 'b' }],
    relationships: [
      { id: 'x', kind: 'parent', from_id: 'a', to_id: 'b' },
      { id: 'y', kind: 'parent', from_id: 'b', to_id: 'a' },
      { id: 'z', kind: 'parent', from_id: 'missing', to_id: 'a' },
    ],
  };
  const layout = treeLayout(invalid, 'a', 'all', false);
  expect(layout.people).toHaveLength(2);
  expect(layout.relationships).toHaveLength(2);
  expect([...layout.positions.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(
    true,
  );
});
