import { expect, it } from 'vitest';
import { graphModel, createFamilySimulation } from './graphLayout';
import type { ArchiveData } from './api';
const data: ArchiveData = {
  people: [
    'p',
    'mother',
    'father',
    'sister',
    'half',
    'step',
    'stepmother',
    'uncle',
    'grandparent',
    'cousin',
    'unlinked',
  ].map((id) => ({ id })),
  relationships: [
    ['father', 'p'],
    ['mother', 'p'],
    ['father', 'sister'],
    ['mother', 'sister'],
    ['father', 'half'],
    ['stepmother', 'step'],
    ['grandparent', 'father'],
    ['grandparent', 'uncle'],
    ['uncle', 'cousin'],
  ]
    .map(([from_id, to_id], i) => ({ id: `r${i}`, kind: 'parent', from_id, to_id }))
    .concat([{ id: 'partner', kind: 'partner', from_id: 'father', to_id: 'stepmother' }]),
  media: [],
  tags: [],
  texts: [],
  text_links: [],
  sources: [],
  facts: [],
};
it('shows all people including disconnected branches and keeps original link endpoints unchanged', () => {
  const model = graphModel(data, 'p', 'all', false);
  expect(model.nodes).toHaveLength(data.people.length);
  const before = JSON.stringify(model);
  const sim = createFamilySimulation(
    model.nodes.map((n) => ({ ...n })),
    model.links.map((l) => ({ ...l })),
    'p',
  );
  sim.tick(300);
  sim.stop();
  expect(JSON.stringify(model)).toBe(before);
  for (const n of sim.nodes()) {
    expect(Number.isFinite(n.x)).toBe(true);
    expect(Number.isFinite(n.y)).toBe(true);
  }
  expect(sim.nodes().find((n) => n.id === 'p')).toMatchObject({ x: 0, y: 0, fx: 0, fy: 0 });
  // Circular nodes have diameter 60; settling must not leave overlapping circles.
  for (const a of sim.nodes())
    for (const b of sim.nodes())
      if (a.id !== b.id) expect(Math.hypot(a.x! - b.x!, a.y! - b.y!)).toBeGreaterThan(100);
  expect(new Set(sim.nodes().map((n) => Math.round(n.y!))).size).toBeGreaterThan(5);
});
it('makes a separate connected graph of siblings, step siblings and cousins and filters its degree', () => {
  const model = graphModel(data, 'p', 'all', true);
  expect(new Set(model.nodes.map((n) => n.id))).toEqual(new Set(['p', 'sister', 'half', 'step', 'cousin']));
  expect(model.links.every((l) => l.source === 'p')).toBe(true);
  const cousin = model.links.find((l) => l.target === 'cousin')!;
  expect(cousin.kind).toBe('cousin');
  const only = graphModel(data, 'p', 'all', true, cousin.label);
  expect(only.nodes.map((n) => n.id)).toEqual(['p', 'cousin']);
  expect(only.links).toHaveLength(1);
});
it('recenters an existing layout on the next selected person', () => {
  const model = graphModel(data, 'p', 'all', false);
  const sim = createFamilySimulation(model.nodes, model.links, 'p');
  sim.tick(200);
  sim.stop();
  const previous = new Map(sim.nodes().map((n) => [n.id, { x: n.x!, y: n.y! }]));
  const next = graphModel(data, 'cousin', 'all', false);
  const centered = createFamilySimulation(next.nodes, next.links, 'cousin', previous);
  expect(centered.nodes().find((n) => n.id === 'cousin')).toMatchObject({ x: 0, y: 0, fx: 0, fy: 0 });
  centered.tick(200);
  centered.stop();
  expect(centered.nodes().find((n) => n.id === 'cousin')).toMatchObject({ x: 0, y: 0 });
});
