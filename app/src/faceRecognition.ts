import { api, mediaUrl, releaseMedia, type Archive, type Item } from './api';
import { validRect, sameRegion, type Rect } from './photoGeometry';

export const FACE_VERSION = 'faceapi-1.7.15-ssd-landmark68-recognition-v1';
export type IndexedFace = Rect & { id: string; descriptor: number[]; score: number };
export type FaceCache = {
  media_id: string;
  sha256: string;
  payload: { faces: IndexedFace[]; width: number; height: number; tag_signature: string };
};
let enginePromise: Promise<typeof import('@vladmandic/face-api')> | undefined;
export async function recognitionEngine() {
  if (!enginePromise)
    enginePromise = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      const tf = faceapi.tf as unknown as {
        setBackend: (name: string) => Promise<boolean>;
        ready: () => Promise<void>;
      };
      try {
        if (!(await tf.setBackend('webgl'))) await tf.setBackend('cpu');
      } catch {
        await tf.setBackend('cpu');
      }
      await tf.ready();
      const base = new URL(`${import.meta.env.BASE_URL}face-recognition/`, document.baseURI).href.replace(
        /\/$/,
        '',
      );
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(base),
        faceapi.nets.faceLandmark68Net.loadFromUri(base),
        faceapi.nets.faceRecognitionNet.loadFromUri(base),
      ]);
      return faceapi;
    })().catch((e) => {
      enginePromise = undefined;
      throw e;
    });
  return enginePromise;
}
export async function loadPhoto(id: string, thumb = false) {
  const image = new Image();
  image.src = await mediaUrl(id, thumb);
  await image.decode();
  if (!image.naturalWidth) throw new Error('Изображение не удалось прочитать');
  return image;
}
function canvasFor(image: HTMLImageElement, rect: Rect = { x: 0, y: 0, w: 1, h: 1 }, max = 2048) {
  const w = image.naturalWidth * rect.w,
    h = image.naturalHeight * rect.h,
    scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d')!.drawImage(
    image,
    rect.x * image.naturalWidth,
    rect.y * image.naturalHeight,
    w,
    h,
    0,
    0,
    c.width,
    c.height,
  );
  return c;
}
const faceId = (r: Rect) => [r.x, r.y, r.w, r.h].map((n) => Math.round(n * 100000)).join('-');
export function tagSignature(tags: Item[]) {
  return JSON.stringify(
    tags
      .filter((t) => validRect(t) && !t.face_id)
      .map((t) => [t.id, t.x, t.y, t.w, t.h])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}
export async function indexPhoto(image: HTMLImageElement, tags: Item[]) {
  const engine = await recognitionEngine();
  const canvas = canvasFor(image);
  const faces: IndexedFace[] = [];
  try {
    const detected = await engine
      .detectAllFaces(canvas, new engine.SsdMobilenetv1Options({ minConfidence: 0.45, maxResults: 200 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    for (const result of detected) {
      const b = result.detection.box;
      const x = Math.max(0, b.x / canvas.width),
        y = Math.max(0, b.y / canvas.height);
      const rect = {
        x,
        y,
        w: Math.min(1 - x, b.width / canvas.width),
        h: Math.min(1 - y, b.height / canvas.height),
      };
      if (validRect(rect))
        faces.push({
          ...rect,
          id: faceId(rect),
          descriptor: Array.from(result.descriptor),
          score: result.detection.score,
        });
    }
    // A manually drawn face can be a reference even when the automatic detector missed it.
    for (const tag of tags.filter((t) => t.person_id && validRect(t) && !t.face_id)) {
      if (faces.some((f) => sameRegion(f, tag as Item & Rect))) continue;
      const rect = { x: tag.x, y: tag.y, w: tag.w, h: tag.h };
      const crop = canvasFor(image, rect, 512);
      try {
        const landmarks = await engine.detectFaceLandmarks(crop);
        if (Array.isArray(landmarks)) continue;
        const aligned = await engine.extractFaces(crop, [landmarks.align()]);
        try {
          if (!aligned[0]) continue;
          const descriptor = await engine.computeFaceDescriptor(aligned[0]);
          if (descriptor instanceof Float32Array)
            faces.push({ ...rect, id: faceId(rect), descriptor: Array.from(descriptor), score: 1 });
        } finally {
          aligned.forEach((c) => {
            c.width = 0;
            c.height = 0;
          });
        }
      } finally {
        crop.width = 0;
        crop.height = 0;
      }
    }
    return {
      faces,
      width: image.naturalWidth,
      height: image.naturalHeight,
      tag_signature: tagSignature(tags),
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
export async function scanFaces(
  archive: Archive,
  cancel: { current: boolean },
  onProgress: (done: number, total: number, title: string) => void,
) {
  const photos = archive.data.media.filter((m) => m.mime?.startsWith('image/'));
  const cached = await api<FaceCache[]>('analysis_get', { kind: 'faces', version: FACE_VERSION });
  const failures: { id: string; title: string }[] = [];
  let done = 0;
  await recognitionEngine();
  for (const media of photos) {
    if (cancel.current) break;
    const tags = archive.data.tags.filter((t) => t.media_id === media.id);
    const previous = cached.find(
      (c) =>
        c.media_id === media.id &&
        c.sha256 === media.sha256 &&
        c.payload.tag_signature === tagSignature(tags),
    );
    onProgress(done, photos.length, media.title);
    if (!previous) {
      let image: HTMLImageElement | undefined;
      try {
        image = await loadPhoto(media.id);
        if (cancel.current) break;
        const payload = await indexPhoto(image, tags);
        if (cancel.current) break;
        await api('analysis_put', {
          kind: 'faces',
          version: FACE_VERSION,
          tree_id: archive.tree_id,
          media_id: media.id,
          sha256: media.sha256,
          payload,
        });
      } catch {
        failures.push({ id: media.id, title: media.title });
      } finally {
        if (image) image.src = '';
        releaseMedia(media.id);
      }
    }
    done++;
    onProgress(done, photos.length, media.title);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return { done, total: photos.length, failures, cancelled: cancel.current };
}
