import { useCallback, useState } from 'react';
import type { Archive, Item } from './api';
export const defaultPerson = (people: Item[]) =>
  people.find((p) => p.external_id === 'I1')?.id || people[0]?.id || '';
const key = (tree: string) => `family-selected-person:${tree}`;
export function readSelectedPerson(tree: string, people: Item[]) {
  let id = '';
  try {
    id = localStorage.getItem(key(tree)) || '';
  } catch {}
  return people.some((p) => p.id === id) ? id : defaultPerson(people);
}
export function useSelectedPerson(archive: Archive | null) {
  const [choice, setChoice] = useState({ tree: '', id: '' });
  const selected = archive
    ? choice.tree === archive.tree_id && archive.data.people.some((p) => p.id === choice.id)
      ? choice.id
      : readSelectedPerson(archive.tree_id, archive.data.people)
    : '';
  const tree = archive?.tree_id || '';
  const select = useCallback(
    (id: string) => {
      if (!tree || !id || id === 'new') return;
      setChoice({ tree, id });
      try {
        localStorage.setItem(key(tree), id);
      } catch {}
    },
    [tree],
  );
  return [selected, select] as const;
}
