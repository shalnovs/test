import { api, type Archive, type Item } from './api';
import { loadPhoto } from './faceRecognition';
const VERSION = 'dhash-v1';
export type Fingerprint = { media_id: string; sha256: string; payload: { hash: string; aspect: number } };
export function hamming(a: string, b: string) {
  let v = BigInt('0x' + a) ^ BigInt('0x' + b),
    count = 0;
  while (v) {
    count++;
    v &= v - 1n;
  }
  return count;
}
export function similarPhotoGroups(media: Item[], prints: Fingerprint[]) {
  const remaining = prints.filter((p) => media.some((m) => m.id === p.media_id));
  const groups: Item[][] = [];
  const used = new Set<string>();
  for (const first of remaining) {
    if (used.has(first.media_id)) continue;
    const matches = remaining.filter(
      (p) =>
        !used.has(p.media_id) &&
        Math.abs(p.payload.aspect / first.payload.aspect - 1) < 0.08 &&
        hamming(p.payload.hash, first.payload.hash) <= 4,
    );
    if (matches.length < 2) continue;
    matches.forEach((p) => used.add(p.media_id));
    groups.push(matches.map((p) => media.find((m) => m.id === p.media_id)!));
  }
  return groups;
}
export async function scanSimilarPhotos(
  archive: Archive,
  cancel: { current: boolean },
  progress: (done: number, total: number) => void,
) {
  const media = archive.data.media.filter((m) => m.mime?.startsWith('image/'));
  const prints = await api<Fingerprint[]>('analysis_get', { kind: 'image', version: VERSION });
  let done = 0,
    failed = 0;
  for (const m of media) {
    if (cancel.current) break;
    if (!prints.some((p) => p.media_id === m.id && p.sha256 === m.sha256)) {
      let image: HTMLImageElement | undefined;
      try {
        image = await loadPhoto(m.id, true);
        const canvas = document.createElement('canvas');
        canvas.width = 9;
        canvas.height = 8;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0, 9, 8);
        const pixels = ctx.getImageData(0, 0, 9, 8).data;
        let hash = 0n;
        const gray = (i: number) => pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++)
            hash = (hash << 1n) | (gray((y * 9 + x) * 4) > gray((y * 9 + x + 1) * 4) ? 1n : 0n);
        const payload = {
          hash: hash.toString(16).padStart(16, '0'),
          aspect: image.naturalWidth / image.naturalHeight,
        };
        canvas.width = 0;
        canvas.height = 0;
        if (cancel.current) break;
        await api('analysis_put', {
          kind: 'image',
          version: VERSION,
          tree_id: archive.tree_id,
          media_id: m.id,
          sha256: m.sha256,
          payload,
        });
        prints.push({ media_id: m.id, sha256: m.sha256, payload });
      } catch {
        failed++;
      } finally {
        if (image) image.src = '';
      }
    }
    progress(++done, media.length);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return { groups: similarPhotoGroups(media, prints), failed };
}
