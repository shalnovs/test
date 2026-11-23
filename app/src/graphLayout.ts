import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import { type ArchiveData } from './api';
import { familySelection, siblingsAndCousins } from './kinship';
export type GraphNode = SimulationNodeDatum & { id: string };
export type GraphLink = SimulationLinkDatum<GraphNode> & { id: string; kind: string; label: string };
export function graphModel(data: ArchiveData, root: string, mode: string, extended: boolean, group = '') {
  const relatives = siblingsAndCousins(data, root).filter((r) => !group || r.group === group);
  const selected = extended
    ? new Set([root, ...relatives.map((r) => r.person.id)])
    : familySelection(data, root, mode, false);
  const nodes: GraphNode[] = data.people.filter((p) => selected.has(p.id)).map((p) => ({ id: p.id }));
  const links: GraphLink[] = extended
    ? relatives.map((r) => ({
        id: `relative:${root}:${r.person.id}`,
        source: root,
        target: r.person.id,
        kind: r.kind,
        label: r.group,
      }))
    : data.relationships
        .filter((r) => selected.has(r.from_id) && selected.has(r.to_id))
        .map((r) => ({
          id: r.id,
          source: r.from_id,
          target: r.to_id,
          kind: r.kind,
          label: r.kind === 'partner' ? 'Брак' : 'Родитель → ребёнок',
        }));
  return { nodes, links };
}
export function createFamilySimulation(
  nodes: GraphNode[],
  links: GraphLink[],
  root: string,
  previous = new Map<string, { x: number; y: number }>(),
) {
  const center = previous.get(root) || { x: 0, y: 0 };
  for (const n of nodes) {
    const p = previous.get(n.id);
    if (p) {
      n.x = p.x - center.x;
      n.y = p.y - center.y;
    }
    if (n.id === root) {
      n.fx = 0;
      n.fy = 0;
      n.x = 0;
      n.y = 0;
    }
  }
  return forceSimulation(nodes)
    .stop()
    .force('charge', forceManyBody().strength(-1350).distanceMax(1600))
    .force(
      'links',
      forceLink<GraphNode, GraphLink>(links)
        .id((n) => n.id)
        .distance((l) => (l.kind === 'partner' ? 145 : l.kind === 'parent' ? 190 : 230))
        .strength(0.32),
    )
    .force('collision', forceCollide<GraphNode>(82).iterations(2))
    .force('x', forceX(0).strength(0.025))
    .force('y', forceY(0).strength(0.025))
    .alphaDecay(0.035)
    .velocityDecay(0.38);
}
