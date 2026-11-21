import { mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const target = resolve('public/face-detection');
const wasm = resolve('node_modules/@mediapipe/tasks-vision/wasm');
await mkdir(`${target}/wasm`, { recursive: true });
for (const name of await readdir(wasm))
  if (/\.(js|wasm)$/.test(name)) await copyFile(`${wasm}/${name}`, `${target}/wasm/${name}`);
const model = `${target}/blaze_face_short_range.tflite`;
const expected = 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f';
const sha = (data) => createHash('sha256').update(data).digest('hex');
let bytes = await readFile(model).catch(() => null);
if (!bytes || sha(bytes) !== expected) {
  const response = await fetch(
    'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
    { signal: AbortSignal.timeout(120000) },
  );
  if (!response.ok) throw new Error(`Face detector model download: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== expected) throw new Error('Face detector model checksum mismatch');
  await writeFile(model, bytes);
}
await copyFile('licenses/mediapipe-APACHE-2.0.txt', `${target}/LICENSE`);
await writeFile(
  `${target}/NOTICE.txt`,
  'MediaPipe Tasks Vision and BlazeFace short-range face detection model. Copyright Google LLC. Apache License 2.0.\nhttps://ai.google.dev/edge/mediapipe/solutions/vision/face_detector\nModel version float16/1; SHA-256: ' +
    expected +
    '\n',
);
console.log('Offline face detection assets verified.');
