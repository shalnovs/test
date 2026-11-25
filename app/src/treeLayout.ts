import dagre from '@dagrejs/dagre';
import type { ArchiveData, Item } from './api';
import { familySelection, siblingsAndCousins } from './kinship';

export const TREE_CARD_WIDTH = 250;
export const TREE_CARD_HEIGHT = 112;
const PARTNER_GAP = 32;

export function treeLayout(data: ArchiveData, root: string, mode: string, extended: boolean, group = '') {
  // A tree shows the actual connecting ancestors, including when a cousin group is selected.
  const selected = extended
    ? new Set([
        root,
        ...siblingsAndCousins(data, root)
          .filter((r) => !group || r.group === group)
          .flatMap((r) => [r.person.id, ...r.paths.flat()]),
      ])
    : familySelection(data, root, mode, false);
  const people = data.people.filter((p) => selected.has(p.id));
  const ids = new Set(people.map((p) => p.id));
  const relationships = data.relationships.filter((r) => ids.has(r.from_id) && ids.has(r.to_id));

  // Keep spouses and the parents of the same child on one generation level.
  // This only affects layout: it does not invent or change any relationships.
  const units = new Map(people.map((p) => [p.id, p.id]));
  function unit(id: string): string {
    const parent = units.get(id)!;
    if (parent === id) return id;
    const result = unit(parent);
    units.set(id, result);
    return result;
  }
  function join(a: string, b: string) {
    const left = unit(a),
      right = unit(b);
    if (left !== right) units.set(right, left);
  }
  const parents = new Map<string, string>();
  for (const r of relationships) {
    if (r.kind === 'partner') join(r.from_id, r.to_id);
    if (r.kind === 'parent') {
      const other = parents.get(r.to_id);
      if (other) join(other, r.from_id);
      else parents.set(r.to_id, r.from_id);
    }
  }
  const members = new Map<string, Item[]>();
  for (const p of people) {
    const id = unit(p.id);
    members.set(id, [...(members.get(id) || []), p]);
  }
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'TB', nodesep: 64, ranksep: 110 });
  graph.setDefaultEdgeLabel(() => ({}));
  const width = (size: number) => size * TREE_CARD_WIDTH + (size - 1) * PARTNER_GAP;
  for (const [id, group] of members)
    graph.setNode(id, { width: width(group.length), height: TREE_CARD_HEIGHT });
  for (const r of relationships) {
    if (r.kind === 'parent' && unit(r.from_id) !== unit(r.to_id))
      graph.setEdge(unit(r.from_id), unit(r.to_id));
  }
  dagre.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  for (const [id, group] of members) {
    const center = graph.node(id);
    group.forEach((p, index) =>
      positions.set(p.id, {
        x: center.x - width(group.length) / 2 + TREE_CARD_WIDTH / 2 + index * (TREE_CARD_WIDTH + PARTNER_GAP),
        y: center.y,
      }),
    );
  }
  const origin = positions.get(root) || { x: 0, y: 0 };
  for (const [id, p] of positions) positions.set(id, { x: p.x - origin.x, y: p.y - origin.y });
  return { people, relationships, positions };
}
