export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export function rectangle(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
export function validRect(r: Partial<Rect> | Record<string, any>): r is Rect {
  return (
    [r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    r.x! >= 0 &&
    r.y! >= 0 &&
    r.w! >= 0.005 &&
    r.h! >= 0.005 &&
    r.x! + r.w! <= 1.001 &&
    r.y! + r.h! <= 1.001
  );
}
export function rectStyle(r: Rect) {
  return { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` };
}
// Compare positions only. No facial features or identities are compared.
export function sameRegion(a: Rect, b: Rect) {
  const area =
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return area / Math.min(a.w * a.h, b.w * b.h) > 0.6;
}
export function newRegions(found: Rect[], existing: Rect[]) {
  const result: Rect[] = [];
  for (const r of found)
    if (validRect(r) && ![...existing, ...result].some((t) => sameRegion(r, t))) result.push(r);
  return result;
}
