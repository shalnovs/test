import { fullName, type ArchiveData, type Item } from './api';

export type Relative = {
  person: Item;
  kind: 'full' | 'half' | 'shared' | 'step' | 'cousin';
  degree: number;
  group: string;
  reason: string;
  paths: string[][];
};
export function parentIndex(data: ArchiveData, biologicalOnly = false) {
  const index = new Map<string, string[]>();
  for (const r of data.relationships.filter(
    (r) => r.kind === 'parent' && (!biologicalOnly || !r.parentage || r.parentage === 'birth'),
  ))
    index.set(r.to_id, [...new Set([...(index.get(r.to_id) || []), r.from_id])]);
  return index;
}
function ancestors(index: Map<string, string[]>, id: string) {
  const result = new Map<string, string[]>(),
    queue = [[id]];
  while (queue.length) {
    const path = queue.shift()!;
    for (const p of index.get(path[path.length - 1]) || []) {
      if (path.includes(p) || result.has(p)) continue;
      const next = [...path, p];
      result.set(p, next);
      queue.push(next);
    }
  }
  return result;
}
const cousinName = (degree: number) =>
  ['Двоюродные', 'Троюродные', 'Четвероюродные', 'Пятиюродные', 'Шестиюродные'][degree - 1] ||
  `${degree + 1}-юродные`;
export function siblingsAndCousins(data: ArchiveData, root: string): Relative[] {
  const index = parentIndex(data, true),
    own = index.get(root) || [],
    lineage = ancestors(index, root);
  const people = new Map(data.people.map((p) => [p.id, p]));
  const names = (ids: string[]) => ids.map((id) => fullName(people.get(id))).join(', ');
  const result: Relative[] = [];
  for (const person of data.people) {
    if (person.id === root || lineage.has(person.id)) continue;
    const otherLineage = ancestors(index, person.id);
    if (otherLineage.has(root)) continue;
    const parents = index.get(person.id) || [],
      common = own.filter((p) => parents.includes(p));
    if (common.length) {
      const kind = common.length >= 2 ? 'full' : own.length >= 2 && parents.length >= 2 ? 'half' : 'shared';
      result.push({
        person,
        kind,
        degree: 0,
        group:
          kind === 'full'
            ? 'Родные'
            : kind === 'half'
              ? 'Неполнородные'
              : 'Общий родитель — сведения неполные',
        reason: `Общие родители: ${names(common)}${kind === 'shared' ? '. Второй родитель указан не у всех' : ''}`,
        paths: common.map((p) => [root, p]).concat(common.map((p) => [person.id, p])),
      });
      continue;
    }
    let best = Infinity,
      paths: string[][] = [],
      shared: string[] = [];
    for (const [id, path] of lineage) {
      const other = otherLineage.get(id);
      if (!other || path.length !== other.length || path.length < 3) continue;
      const degree = path.length - 2;
      if (degree < best) {
        best = degree;
        paths = [];
        shared = [];
      }
      if (degree === best) {
        paths.push(path, other);
        shared.push(id);
      }
    }
    if (Number.isFinite(best)) {
      result.push({
        person,
        kind: 'cousin',
        degree: best,
        group: cousinName(best),
        reason: `Общие предки: ${names(shared)}`,
        paths,
      });
      continue;
    }
    const marriage = data.relationships.find(
      (r) =>
        r.kind === 'partner' &&
        ((own.includes(r.from_id) && parents.includes(r.to_id)) ||
          (own.includes(r.to_id) && parents.includes(r.from_id))),
    );
    if (marriage)
      result.push({
        person,
        kind: 'step',
        degree: 0,
        group: 'Сводные — брак родителей',
        reason: `Брак родителей: ${names([marriage.from_id, marriage.to_id])}. Общие родители в архиве не указаны`,
        paths: own.map((p) => [root, p]).concat(parents.map((p) => [person.id, p])),
      });
  }
  const order = { full: 0, half: 1, shared: 2, step: 3, cousin: 4 };
  return result.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      a.degree - b.degree ||
      fullName(a.person).localeCompare(fullName(b.person), 'ru'),
  );
}
export function familySelection(data: ArchiveData, root: string, mode: string, extended: boolean) {
  const selected = new Set([root]);
  if (mode === 'all') data.people.forEach((p) => selected.add(p.id));
  else if (mode === 'family') {
    data.relationships.forEach((r) => {
      if (r.from_id === root) selected.add(r.to_id);
      if (r.to_id === root) selected.add(r.from_id);
    });
  } else {
    const queue = [root];
    while (queue.length) {
      const id = queue.pop();
      for (const r of data.relationships.filter((r) => r.kind === 'parent')) {
        const next =
          mode === 'ancestors' && r.to_id === id
            ? r.from_id
            : mode === 'descendants' && r.from_id === id
              ? r.to_id
              : '';
        if (next && !selected.has(next)) {
          selected.add(next);
          queue.push(next);
        }
      }
    }
  }
  if (mode === 'family' || extended)
    for (const r of siblingsAndCousins(data, root)) {
      if (!extended && r.kind === 'cousin') continue;
      selected.add(r.person.id);
      r.paths.flat().forEach((p) => selected.add(p));
    }
  return selected;
}
export function familyLevels(data: ArchiveData, root: string, extended: boolean) {
  const levels = new Map<string, number>([[root, 0]]);
  for (const r of data.relationships) {
    if (r.from_id === root) levels.set(r.to_id, r.kind === 'parent' ? 1 : 0);
    if (r.to_id === root) levels.set(r.from_id, r.kind === 'parent' ? -1 : 0);
  }
  for (const relative of siblingsAndCousins(data, root))
    if (extended || relative.kind !== 'cousin') {
      levels.set(relative.person.id, 0);
      for (const path of relative.paths)
        path.forEach((p, i) => {
          if (!levels.has(p)) levels.set(p, -i);
        });
    }
  return levels;
}
