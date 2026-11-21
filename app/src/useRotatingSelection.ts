import { useEffect, useRef, useState } from 'react';
import type { Item } from './api';

function shuffle(ids: string[]) {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function randomSelection(ids: string[], count: number, previous: string[] = []) {
  const unique = [...new Set(ids)];
  const fresh = shuffle(unique.filter((id) => !previous.includes(id)));
  const old = shuffle(unique.filter((id) => previous.includes(id)));
  const result = [...fresh, ...old].slice(0, count);
  if (result.length > 1 && result.every((id, i) => id === previous[i])) result.push(result.shift()!);
  return result;
}
export function useRotatingSelection(photos: Item[], stories: Item[]) {
  const items = useRef({ photos, stories });
  items.current = { photos, stories };
  const signature = JSON.stringify([photos.map((p) => p.id), stories.map((t) => t.id)]);
  const [selection, setSelection] = useState(() => ({
    photos: randomSelection(
      photos.map((p) => p.id),
      3,
    ),
    stories: randomSelection(
      stories.map((t) => t.id),
      2,
    ),
  }));
  useEffect(() => {
    const rotate = () =>
      setSelection((current) => ({
        photos: randomSelection(
          items.current.photos.map((p) => p.id),
          3,
          current.photos,
        ),
        stories: randomSelection(
          items.current.stories.map((t) => t.id),
          2,
          current.stories,
        ),
      }));
    // Refresh membership after importing/removing data; ordinary annotation saves do not reset the timer.
    setSelection((current) => ({
      photos:
        current.photos.length && current.photos.every((id) => items.current.photos.some((p) => p.id === id))
          ? current.photos
          : randomSelection(
              items.current.photos.map((p) => p.id),
              3,
            ),
      stories:
        current.stories.length &&
        current.stories.every((id) => items.current.stories.some((t) => t.id === id))
          ? current.stories
          : randomSelection(
              items.current.stories.map((t) => t.id),
              2,
            ),
    }));
    const timer = window.setInterval(rotate, 60_000);
    return () => window.clearInterval(timer);
  }, [signature]);
  return {
    photos: selection.photos.map((id) => photos.find((p) => p.id === id)).filter((p): p is Item => !!p),
    stories: selection.stories.map((id) => stories.find((t) => t.id === id)).filter((t): t is Item => !!t),
  };
}
