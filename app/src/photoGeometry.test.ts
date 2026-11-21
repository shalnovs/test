import { describe, it, expect } from 'vitest';
import { newRegions, rectangle, validRect } from './photoGeometry';
import { randomSelection } from './useRotatingSelection';

describe('photo regions', () => {
  it('accepts reverse drags and rejects incomplete or outside coordinates', () => {
    expect(rectangle({ x: 0.8, y: 0.9 }, { x: 0.1, y: 0.2 })).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.7000000000000001,
      h: 0.7,
    });
    for (const r of [
      { x: 0.2, y: 0.2, w: 0, h: 0.2 },
      { x: NaN, y: 0.1, w: 0.2, h: 0.2 },
      { x: 0.9, y: 0.1, w: 0.4, h: 0.4 },
      {},
    ])
      expect(validRect(r)).toBe(false);
  });
  it('does not propose duplicate detections or an already annotated region', () => {
    const a = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      b = { x: 0.6, y: 0.2, w: 0.1, h: 0.15 };
    expect(newRegions([a, { ...a, x: 0.11 }, b, b], [a])).toEqual([b]);
  });
});
describe('home rotation', () => {
  it('uses fresh material when available, without repeating IDs', () => {
    const previous = ['a', 'b', 'c'];
    expect(randomSelection(['a', 'b', 'c', 'd', 'e', 'f', 'f'], 3, previous).sort()).toEqual(['d', 'e', 'f']);
    expect(previous).toEqual(['a', 'b', 'c']);
  });
  it('handles short archives and does not leave the same ordering', () => {
    expect(randomSelection([], 3)).toEqual([]);
    expect(randomSelection(['a'], 3, ['a'])).toEqual(['a']);
    expect(randomSelection(['a', 'b'], 3, ['a', 'b'])).toEqual(['b', 'a']);
  });
});
