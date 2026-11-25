import type { ArchiveData } from './api';
import { createFamilySimulation, graphModel, type GraphLink } from './graphLayout';
import { treeLayout } from './treeLayout';

export type GraphPoint = { x: number; y: number };
type GraphModel = ReturnType<typeof graphModel>;
type Segment = { a: number; b: number; start: GraphPoint; end: GraphPoint; length: number };
const id = (value: GraphLink['source']) => (typeof value === 'object' ? value.id : String(value));
const sideOpposite = { Left: 'Right', Right: 'Left', Top: 'Bottom', Bottom: 'Top' } as const;

// Use the same attachment points for arranging the graph and drawing its lines.
export function graphEdgeGeometry(a: GraphPoint, b: GraphPoint) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'Right' : 'Left') : dy > 0 ? 'Bottom' : 'Top';
  const offset = {
    Left: { x: -30, y: 0 },
    Right: { x: 30, y: 0 },
    Top: { x: 0, y: -30 },
    Bottom: { x: 0, y: 30 },
  }[side];
  return {
    side,
    opposite: sideOpposite[side],
    length: Math.hypot(dx, dy),
    start: { x: a.x + offset.x, y: a.y + offset.y },
    end: { x: b.x - offset.x, y: b.y - offset.y },
  };
}
const cross = (a: GraphPoint, b: GraphPoint, p: GraphPoint) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
function onSegment(a: GraphPoint, b: GraphPoint, p: GraphPoint) {
  return (
    Math.abs(cross(a, b, p)) < 1e-6 &&
    p.x >= Math.min(a.x, b.x) - 1e-6 &&
    p.x <= Math.max(a.x, b.x) + 1e-6 &&
    p.y >= Math.min(a.y, b.y) - 1e-6 &&
    p.y <= Math.max(a.y, b.y) + 1e-6
  );
}
function intersects(a: GraphPoint, b: GraphPoint, c: GraphPoint, d: GraphPoint) {
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y)
  )
    return false;
  const ac = cross(a, b, c),
    ad = cross(a, b, d),
    ca = cross(c, d, a),
    cb = cross(c, d, b);
  return (
    (ac * ad < 0 && ca * cb < 0) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}
function nearSegment(a: GraphPoint, b: GraphPoint, p: GraphPoint) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  if (!length) return false;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2 < 42 ** 2;
}
function indexed(model: GraphModel) {
  const indices = new Map(model.nodes.map((n, i) => [n.id, i]));
  return model.links.flatMap((l) => {
    const a = indices.get(id(l.source)),
      b = indices.get(id(l.target));
    return a === undefined || b === undefined || a === b ? [] : [{ a, b, kind: l.kind }];
  });
}
function evaluate(points: GraphPoint[], links: ReturnType<typeof indexed>) {
  let crossings = 0,
    overlaps = 0,
    throughPeople = 0,
    length = 0;
  const trouble = new Array<number>(points.length).fill(0),
    crossingPairs: number[][] = [];
  const segments: Segment[] = links.map((l) => {
    length +=
      Math.hypot(points[l.a].x - points[l.b].x, points[l.a].y - points[l.b].y) *
      (l.kind === 'partner' ? 1.5 : 1);
    return { ...l, ...graphEdgeGeometry(points[l.a], points[l.b]) };
  });
  for (let a = 0; a < points.length; a++)
    for (let b = a + 1; b < points.length; b++) {
      if (Math.abs(points[a].x - points[b].x) < 184 && Math.abs(points[a].y - points[b].y) < 144) {
        overlaps++;
        trouble[a] += 4;
        trouble[b] += 4;
      }
    }
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j];
      if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
      if (intersects(a.start, a.end, b.start, b.end)) {
        crossings++;
        const nodes = [a.a, a.b, b.a, b.b];
        crossingPairs.push(nodes);
        for (const n of nodes) trouble[n]++;
      }
    }
    for (let n = 0; n < points.length; n++) {
      if (n !== a.a && n !== a.b && nearSegment(a.start, a.end, points[n])) {
        throughPeople++;
        trouble[n] += 2;
        trouble[a.a]++;
        trouble[a.b]++;
      }
    }
  }
  return {
    crossings,
    overlaps,
    throughPeople,
    length,
    trouble,
    crossingPairs,
    cost: overlaps * 1e9 + throughPeople * 20000 + crossings * 10000 + length / 1000,
  };
}
export function graphReadability(model: GraphModel, positions: Map<string, GraphPoint>) {
  const { crossings, overlaps, throughPeople, length } = evaluate(
    model.nodes.map((n) => positions.get(n.id)!),
    indexed(model),
  );
  return { crossings, overlaps, throughPeople, length };
}
function center(model: GraphModel, points: GraphPoint[], root: string) {
  const origin = points[model.nodes.findIndex((n) => n.id === root)] || { x: 0, y: 0 };
  return new Map(model.nodes.map((n, i) => [n.id, { x: points[i].x - origin.x, y: points[i].y - origin.y }]));
}
function spaced(points: GraphPoint[]) {
  points = points.map((p) => ({ ...p }));
  for (let i = 0; i < points.length; i++) {
    while (points.slice(0, i).some((p) => Math.hypot(p.x - points[i].x, p.y - points[i].y) < 1e-6)) {
      points[i].x += 1 + (i % 13);
      points[i].y += 1 + Math.floor(i / 13);
    }
  }
  let minimum = Infinity;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      minimum = Math.min(minimum, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
  const scale = Math.max(1, 240 / Math.max(minimum, 1));
  return points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
}

// Cache untouched lines: a proposal moves only one or two people, not the whole graph.
class Arrangement {
  segments: Segment[];
  crossings: Uint8Array;
  hits: Uint8Array;
  adjacent: number[][];
  score: ReturnType<typeof evaluate>;
  constructor(
    public points: GraphPoint[],
    public links: ReturnType<typeof indexed>,
  ) {
    this.segments = links.map((l) => ({ ...l, ...graphEdgeGeometry(points[l.a], points[l.b]) }));
    this.crossings = new Uint8Array(links.length * links.length);
    this.hits = new Uint8Array(links.length * points.length);
    this.adjacent = points.map(() => []);
    this.score = evaluate(points, links);
    for (let i = 0; i < links.length; i++) {
      const a = this.segments[i];
      this.adjacent[a.a].push(i);
      this.adjacent[a.b].push(i);
      for (let j = i + 1; j < links.length; j++) {
        const b = this.segments[j];
        if (a.a !== b.a && a.a !== b.b && a.b !== b.a && a.b !== b.b)
          this.crossings[i * links.length + j] = +intersects(a.start, a.end, b.start, b.end);
      }
      for (let n = 0; n < points.length; n++)
        if (n !== a.a && n !== a.b)
          this.hits[i * points.length + n] = +nearSegment(a.start, a.end, points[n]);
    }
  }
  trouble() {
    const counts = new Array<number>(this.points.length).fill(0),
      pairs: number[][] = [];
    for (let i = 0; i < this.links.length; i++) {
      const a = this.links[i];
      for (let j = i + 1; j < this.links.length; j++)
        if (this.crossings[i * this.links.length + j]) {
          const b = this.links[j],
            nodes = [a.a, a.b, b.a, b.b];
          pairs.push(nodes);
          for (const n of nodes) counts[n]++;
        }
      for (let n = 0; n < this.points.length; n++)
        if (this.hits[i * this.points.length + n]) {
          counts[n] += 2;
          counts[a.a]++;
          counts[a.b]++;
        }
    }
    return { counts, pairs };
  }
  trial(changed: number[], commit = false) {
    const { points, links } = this;
    // Every seed reserves a rectangle for the portrait and name; keep that space when moving it.
    for (const a of changed)
      for (let b = 0; b < points.length; b++)
        if (a !== b && Math.abs(points[a].x - points[b].x) < 184 && Math.abs(points[a].y - points[b].y) < 144)
          return Infinity;
    const dirty = new Set(changed.flatMap((n) => this.adjacent[n]));
    const moved = new Map(
      [...dirty].map((i) => [
        i,
        { ...links[i], ...graphEdgeGeometry(points[links[i].a], points[links[i].b]) },
      ]),
    );
    let crossings = this.score.crossings,
      throughPeople = this.score.throughPeople,
      length = this.score.length;
    for (const i of dirty) {
      const a = moved.get(i)!;
      const old = this.segments[i];
      const weight = links[i].kind === 'partner' ? 1.5 : 1;
      length += (a.length - old.length) * weight;
      for (let j = 0; j < links.length; j++) {
        if (i === j || (dirty.has(j) && j < i)) continue;
        const b = moved.get(j) || this.segments[j];
        if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
        const key = Math.min(i, j) * links.length + Math.max(i, j),
          next = +intersects(a.start, a.end, b.start, b.end);
        crossings += next - this.crossings[key];
        if (commit) this.crossings[key] = next;
      }
      for (let n = 0; n < points.length; n++)
        if (n !== a.a && n !== a.b) {
          const key = i * points.length + n,
            next = +nearSegment(a.start, a.end, points[n]);
          throughPeople += next - this.hits[key];
          if (commit) this.hits[key] = next;
        }
    }
    for (let i = 0; i < links.length; i++)
      if (!dirty.has(i)) {
        const a = this.segments[i];
        for (const n of changed)
          if (n !== a.a && n !== a.b) {
            const key = i * points.length + n,
              next = +nearSegment(a.start, a.end, points[n]);
            throughPeople += next - this.hits[key];
            if (commit) this.hits[key] = next;
          }
      }
    const cost = throughPeople * 20000 + crossings * 10000 + length / 1000;
    if (commit) {
      for (const [i, segment] of moved) this.segments[i] = segment;
      this.score = { ...this.score, crossings, throughPeople, length, cost };
    }
    return cost;
  }
}

// Coordinate moves and endpoint swaps reduce actual line intersections while reserving space for names.
// The search is bounded and deterministic; it does not claim a global optimum for arbitrary graphs.
export function untangleGraph(model: GraphModel, positions: Map<string, GraphPoint>, root: string) {
  let points = model.nodes.map((n) => ({ ...positions.get(n.id)! }));
  const links = indexed(model),
    fixed = model.nodes.findIndex((n) => n.id === root);
  if (evaluate(points, links).overlaps) points = spaced(points);
  const state = new Arrangement(points, links);
  const directions = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];
  for (const step of [180, 90, 45, 22, 11]) {
    for (let pass = 0; pass < 3; pass++) {
      if (!state.score.crossings && !state.score.overlaps && !state.score.throughPeople)
        return center(model, points, root);
      let changed = false;
      const { counts, pairs } = state.trouble();
      const trouble = counts
        .map((count, i) => ({ count, i }))
        .filter((v) => v.count && v.i !== fixed)
        .sort((a, b) => b.count - a.count || a.i - b.i)
        .slice(0, 36);
      for (const { i } of trouble) {
        const original = points[i];
        let best = original,
          bestCost = state.score.cost;
        const proposals = directions.map(([dx, dy]) => ({
          x: original.x + dx * step,
          y: original.y + dy * step,
        }));
        for (const pair of pairs.filter((p) => p.includes(i)).slice(0, 6)) {
          const [a, b] = pair
            .slice(pair[0] === i || pair[1] === i ? 2 : 0, pair[0] === i || pair[1] === i ? 4 : 2)
            .map((n) => points[n]);
          const dx = b.x - a.x,
            dy = b.y - a.y,
            length = dx * dx + dy * dy;
          if (length) {
            const t = ((original.x - a.x) * dx + (original.y - a.y) * dy) / length;
            proposals.push({ x: 2 * (a.x + t * dx) - original.x, y: 2 * (a.y + t * dy) - original.y });
          }
        }
        for (const proposal of proposals) {
          points[i] = proposal;
          const cost = state.trial([i]);
          if (cost < bestCost - 1e-6) {
            best = points[i];
            bestCost = cost;
          }
        }
        points[i] = best;
        if (best !== original) {
          state.trial([i], true);
          changed = true;
        }
      }
      const swaps = new Set<string>();
      for (const [a, b, c, d] of state.trouble().pairs)
        for (const left of [a, b])
          for (const right of [c, d]) {
            if (left !== fixed && right !== fixed)
              swaps.add([Math.min(left, right), Math.max(left, right)].join(':'));
          }
      for (const key of [...swaps].slice(0, 100)) {
        const [a, b] = key.split(':').map(Number);
        [points[a], points[b]] = [points[b], points[a]];
        const cost = state.trial([a, b]);
        if (cost < state.score.cost - 1e-6) {
          state.trial([a, b], true);
          changed = true;
        } else [points[a], points[b]] = [points[b], points[a]];
      }
      if (!changed) break;
    }
  }
  return center(model, points, root);
}

export function tidyFamilyGraph(
  data: ArchiveData,
  root: string,
  mode: string,
  extended: boolean,
  group = '',
) {
  const model = graphModel(data, root, mode, extended, group);
  if (model.nodes.length < 2) return new Map(model.nodes.map((n) => [n.id, { x: 0, y: 0 }]));
  if (extended) {
    const relatives = model.nodes.filter((n) => n.id !== root);
    const radius = Math.max(260, (relatives.length * 250) / (2 * Math.PI));
    return new Map([
      [root, { x: 0, y: 0 }],
      ...relatives.map((n, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / relatives.length;
        return [n.id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }] as const;
      }),
    ]);
  }
  const hierarchy = treeLayout(data, root, mode, false).positions;
  const seeds: GraphPoint[][] = [
    model.nodes.map((n) => {
      const p = hierarchy.get(n.id)!;
      return { x: p.x * 0.85, y: p.y };
    }),
  ];
  for (const initial of [new Map<string, GraphPoint>(), hierarchy]) {
    const sim = createFamilySimulation(
      model.nodes.map((n) => ({ ...n })),
      model.links.map((l) => ({ ...l })),
      root,
      initial,
    );
    sim.tick(220);
    sim.stop();
    seeds.push(spaced(sim.nodes().map((n) => ({ x: n.x || 0, y: n.y || 0 }))));
  }
  const links = indexed(model);
  const candidates = seeds
    .map((points) => ({ points, score: evaluate(points, links) }))
    .sort((a, b) => a.score.cost - b.score.cost);
  let best = center(model, candidates[0].points, root),
    bestScore = candidates[0].score;
  for (const candidate of candidates
    .filter((c) => c.score.cost <= candidates[0].score.cost * 1.3)
    .slice(0, 2)) {
    const arranged = untangleGraph(model, center(model, candidate.points, root), root);
    const score = evaluate(
      model.nodes.map((n) => arranged.get(n.id)!),
      links,
    );
    if (score.cost <= bestScore.cost) {
      best = arranged;
      bestScore = score;
    }
    if (!bestScore.crossings && !bestScore.overlaps && !bestScore.throughPeople) break;
  }
  for (const scale of [1.2, 1]) {
    if (!bestScore.crossings && !bestScore.throughPeople) break;
    const seed = new Map([...best].map(([id, p]) => [id, { x: p.x * scale, y: p.y * scale }]));
    const arranged = untangleGraph(model, seed, root);
    const score = evaluate(
      model.nodes.map((n) => arranged.get(n.id)!),
      links,
    );
    if (score.cost < bestScore.cost) {
      best = arranged;
      bestScore = score;
    }
  }
  return best;
}
