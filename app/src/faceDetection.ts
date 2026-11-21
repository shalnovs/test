import { newRegions, type Rect } from './photoGeometry';
import type { FaceDetector } from '@mediapipe/tasks-vision';

let detectorPromise: Promise<FaceDetector> | undefined;
async function detector() {
  if (!detectorPromise)
    detectorPromise = (async () => {
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const base = new URL(`${import.meta.env.BASE_URL}face-detection/`, document.baseURI).href;
      const vision = await FilesetResolver.forVisionTasks(`${base}wasm`);
      return FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${base}blaze_face_short_range.tflite`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.6,
      });
    })().catch((error) => {
      detectorPromise = undefined;
      throw error;
    });
  return detectorPromise;
}

// Local face locations only; identifying a person is always a manual choice.
export async function detectFaces(image: HTMLImageElement): Promise<Rect[]> {
  const engine = await detector();
  const width = image.naturalWidth,
    height = image.naturalHeight;
  if (!width || !height) throw new Error('Дождитесь загрузки фотографии');
  const crops = [{ x: 0, y: 0, w: 1, h: 1 }];
  // Overlapping crops help find small faces in group photographs.
  if (width > 700 || height > 700)
    for (const x of [0, 0.4]) for (const y of [0, 0.4]) crops.push({ x, y, w: 0.6, h: 0.6 });
  const result: Rect[] = [];
  for (const crop of crops) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1280 / Math.max(width * crop.w, height * crop.h));
    canvas.width = Math.round(width * crop.w * scale);
    canvas.height = Math.round(height * crop.h * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось прочитать фотографию');
    context.drawImage(
      image,
      width * crop.x,
      height * crop.y,
      width * crop.w,
      height * crop.h,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    for (const detection of engine.detect(canvas).detections) {
      const b = detection.boundingBox;
      if (!b) continue;
      const x = Math.max(0, crop.x + ((b.originX - b.width * 0.08) / canvas.width) * crop.w);
      const y = Math.max(0, crop.y + ((b.originY - b.height * 0.12) / canvas.height) * crop.h);
      const right = Math.min(1, crop.x + ((b.originX + b.width * 1.08) / canvas.width) * crop.w);
      const bottom = Math.min(1, crop.y + ((b.originY + b.height * 1.12) / canvas.height) * crop.h);
      result.push({ x, y, w: right - x, h: bottom - y });
    }
  }
  return newRegions(result, []);
}
