// Development only. The shipped desktop app uses Tauri IPC and has no HTTP server.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
if (!process.env.FAMILY_DATA_DIR) throw new Error('FAMILY_DATA_DIR must point to an isolated test archive');
const cli = resolve('target/debug/family-cli' + (process.platform === 'win32' ? '.exe' : ''));
const child = spawn(cli, [process.env.FAMILY_DATA_DIR], {
  stdio: ['pipe', 'pipe', 'inherit'],
  windowsHide: true,
});
const pending = [];
let alive = true;
createInterface({ input: child.stdout }).on('line', (line) => {
  const cb = pending.shift();
  if (cb) cb(null, line);
});
child.on('error', (e) => {
  alive = false;
  while (pending.length) pending.shift()(e);
});
child.on('exit', () => {
  alive = false;
  while (pending.length) pending.shift()(new Error('Archive process exited'));
});
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' || req.url !== '/api') {
    res.writeHead(404);
    return res.end('{}');
  }
  const origin = req.headers.origin;
  if (origin && !['http://127.0.0.1:1420', 'http://localhost:1420'].includes(origin)) {
    res.writeHead(403);
    return res.end('{}');
  }
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 360 * 1024 * 1024) throw new Error('Request too large');
      chunks.push(chunk);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!alive) throw new Error('Archive process unavailable');
    const result = await new Promise((resolve, reject) => {
      pending.push((e, line) => (e ? reject(e) : resolve(line)));
      child.stdin.write(JSON.stringify(value) + '\n');
    });
    res.end(result);
  } catch (e) {
    res.writeHead(400);
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
});
server.listen(4311, '127.0.0.1', () => console.log('Test archive ready on localhost:4311'));
function stop() {
  server.close();
  child.kill();
  process.exit();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
