import { useState } from 'react';

export type FamilyView = 'graph' | 'tree';
const key = (tree: string) => `family-view:${tree}`;

function readView(tree: string): FamilyView {
  try {
    if (localStorage.getItem(key(tree)) === 'tree') return 'tree';
  } catch {}
  return 'graph';
}

export function useFamilyView(tree: string) {
  const [choice, setChoice] = useState<{ tree: string; view: FamilyView }>();
  const view = choice?.tree === tree ? choice.view : readView(tree);
  const selectView = (view: FamilyView) => {
    setChoice({ tree, view });
    try {
      localStorage.setItem(key(tree), view);
    } catch {}
  };
  return [view, selectView] as const;
}
