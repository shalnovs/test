import { expect, it } from 'vitest';
import type { ArchiveData } from './api';
import { createFamilySimulation, graphModel } from './graphLayout';
import { graphReadability, tidyFamilyGraph, untangleGraph } from './graphReadability';

const data: ArchiveData = {
  people: [
    'root',
    'father',
    'mother',
    'sister',
    'grandfather',
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
    ['spouse', 'son'],
  ]
    .map(([from_id, to_id], i) => ({ id: `p${i}`, kind: 'parent', from_id, to_id }))
    .concat([
      { id: 'm1', kind: 'partner', from_id: 'father', to_id: 'mother' },
      { id: 'm2', kind: 'partner', from_id: 'root', to_id: 'spouse' },
    ]),
  media: [],
  tags: [],
  texts: [],
  text_links: [],
  sources: [],
  facts: [],
};

it('untangles crossing lines without moving the chosen center or changing relationships', () => {
  const model = {
    nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id })),
    links: [
      { id: 'ab', source: 'a', target: 'b', kind: 'parent', label: '' },
      { id: 'cd', source: 'c', target: 'd', kind: 'parent', label: '' },
    ],
  };
  const points = new Map([
    ['a', { x: -300, y: -200 }],
    ['b', { x: 300, y: 200 }],
    ['c', { x: -300, y: 200 }],
    ['d', { x: 300, y: -200 }],
  ]);
  const before = JSON.stringify([model, [...points]]);
  expect(graphReadability(model, points).crossings).toBe(1);
  const arranged = untangleGraph(model, points, 'a');
  expect(arranged.get('a')).toEqual({ x: 0, y: 0 });
  expect(graphReadability(model, arranged)).toMatchObject({ crossings: 0, overlaps: 0, throughPeople: 0 });
  expect(JSON.stringify([model, [...points]])).toBe(before);
});

it('counts overlapping unrelated lines but excludes the legitimate meeting of lines at one person', () => {
  const model = {
    nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id })),
    links: [
      { id: 'ab', source: 'a', target: 'b', kind: 'parent', label: '' },
      { id: 'cd', source: 'c', target: 'd', kind: 'parent', label: '' },
    ],
  };
  const points = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 1000, y: 0 }],
    ['c', { x: 200, y: 0 }],
    ['d', { x: 800, y: 0 }],
  ]);
  expect(graphReadability(model, points)).toMatchObject({ crossings: 1, throughPeople: 2 });
  model.links[1].source = 'a';
  points.set('d', { x: 400, y: 400 });
  expect(graphReadability(model, points).crossings).toBe(0);
});

it('starts the whole family with fewer crossings and clear names, including disconnected people', () => {
  const before = JSON.stringify(data),
    model = graphModel(data, 'root', 'all', false);
  const sim = createFamilySimulation(
    model.nodes.map((n) => ({ ...n })),
    model.links.map((l) => ({ ...l })),
    'root',
  );
  sim.tick(35);
  sim.stop();
  const old = graphReadability(model, new Map(sim.nodes().map((n) => [n.id, { x: n.x!, y: n.y! }])));
  const positions = tidyFamilyGraph(data, 'root', 'all', false),
    quality = graphReadability(model, positions);
  expect(quality.crossings).toBeLessThan(old.crossings);
  expect(quality).toMatchObject({ overlaps: 0, throughPeople: 0 });
  expect(positions.size).toBe(data.people.length);
  expect(positions.get('root')).toEqual({ x: 0, y: 0 });
  expect(JSON.stringify(data)).toBe(before);
  expect(tidyFamilyGraph(data, 'root', 'all', false)).toEqual(positions);
});

it('gives siblings a non-crossing radial layout and supports tiny or empty archives', () => {
  const model = graphModel(data, 'root', 'all', true);
  const points = tidyFamilyGraph(data, 'root', 'all', true);
  expect(points.size).toBe(model.nodes.length);
  expect(graphReadability(model, points)).toMatchObject({ crossings: 0, overlaps: 0, throughPeople: 0 });
  expect(tidyFamilyGraph({ ...data, people: [] }, '', 'all', false).size).toBe(0);
  expect(
    tidyFamilyGraph({ ...data, people: [{ id: 'only' }], relationships: [] }, 'only', 'all', false),
  ).toEqual(new Map([['only', { x: 0, y: 0 }]]));
});
