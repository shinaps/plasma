import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorMessage } from '../shared/errors.ts';
import { limits } from '../shared/limits.ts';
import { startProjects } from './lifecycle.ts';
import { readBody } from './read-body.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const projects = startProjects();
// URL のフラグメントで渡す。サーバーにも Referer にも送られないので、ログに残らない。
const token = randomBytes(32).toString('hex');
const html = fs.readFileSync(path.join(here, '../dist/index.html'));
// listen が完了してポートが決まってから設定する。要求は listen の後にしか届かないので、ハンドラでは常に設定済み。
let origin = '';
const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  // 他のサイトから loopback へ向けた要求を拒否する (DNS rebinding とブラウザからの CSRF)。
  if (
    request.headers.host !== new URL(origin).host ||
    (request.headers.origin && request.headers.origin !== origin)
  ) {
    response.writeHead(403).end();
    return;
  }
  if (request.method === 'GET' && request.url === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
    return;
  }
  if (request.method !== 'POST' || request.url !== '/api') {
    response.writeHead(404).end();
    return;
  }
  const header = request.headers['x-workbench-token'];
  const auth = Buffer.from(typeof header === 'string' ? header : '');
  if (auth.length !== token.length || !timingSafeEqual(auth, Buffer.from(token))) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  try {
    const input: unknown = JSON.parse(await readBody(request, limits.requestBody));
    response.end(JSON.stringify(await projects.dispatch(input)));
  } catch (error) {
    // 応答には文言だけを返す。原因とスタックはサーバーのログに残す。
    console.error(error);
    // 本文を読み切らずに応答したときは、この接続を再利用させない。残りの本文が次の要求に混ざるため。
    if (!request.complete) response.setHeader('Connection', 'close');
    response.writeHead(400).end(JSON.stringify({ error: errorMessage(error) }));
  }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server has no TCP address.');
  origin = `http://127.0.0.1:${address.port}`;
  console.log(JSON.stringify({ url: `${origin}/#${token}` }));
});
