import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = JSON.parse(await readFile('licenses/face-recognition-files.json', 'utf8'));
await mkdir('public/face-recognition', { recursive: true });
for (const [name, expected] of Object.entries(files)) {
  const destination = `public/face-recognition/${name}`;
  let data = await readFile(destination).catch(() => null);
  if (!data || createHash('sha256').update(data).digest('hex') !== expected) {
    data = await readFile(`node_modules/@vladmandic/face-api/model/${name}`);
    if (createHash('sha256').update(data).digest('hex') !== expected)
      throw new Error(`Installed recognition model checksum mismatch: ${name}`);
    await writeFile(destination, data);
  }
  if (createHash('sha256').update(data).digest('hex') !== expected)
    throw new Error(`Recognition model checksum mismatch: ${name}`);
}
await copyFile('node_modules/@vladmandic/face-api/LICENSE', 'public/face-recognition/LICENSE.txt');
await writeFile('public/face-recognition/NOTICE.txt',
  '@vladmandic/face-api 1.7.15, MIT. Models copied from the locked npm package and checked by SHA-256.\nhttps://github.com/vladmandic/face-api\nFace detection, landmarks and local face matching. No age, gender or emotion models are included.\n');
console.log('Offline face recognition models verified.');
