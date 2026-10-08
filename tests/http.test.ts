import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { limits } from '../shared/limits.ts';

const here = path.dirname(new URL(import.meta.url).pathname);
const built = fs.existsSync(path.join(here, '../dist/index.html'));

/** HTTP サーバーを起動し、表示された URL とトークンを返す。 */
async function startServer(context: { after: (fn: () => void) => void }) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-http-'));
  const child = spawn(process.execPath, [path.join(here, '../server/http.ts')], {
    env: { ...process.env, WORKBENCH_STATE_DIR: state },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(state, { recursive: true, force: true });
  });
  const line = await new Promise<string>((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('\n')) resolve(output.slice(0, output.indexOf('\n')));
    });
    child.stderr.on('data', (chunk: Buffer) => reject(new Error(chunk.toString())));
    child.once('exit', (code) => reject(new Error(`server exited: ${code}`)));
  });
  const url = new URL(JSON.parse(line).url as string);
  return { origin: url.origin, token: url.hash.slice(1), state };
}

test('HTTP の入口は Host・Origin・トークンで守り、本文の上限と境界の外を拒否する', {
  skip: !built && 'dist/index.html がない (pnpm build が必要)',
}, async (context) => {
  const { origin, token } = await startServer(context);
  const api = (init: RequestInit & { headers?: Record<string, string> }) =>
    fetch(`${origin}/api`, { method: 'POST', ...init });
  const headers = { 'Content-Type': 'application/json', 'X-Workbench-Token': token };
  const body = JSON.stringify({ op: 'project-list' });
  // 認証済みの要求は通る。
  const ok = await api({ headers, body });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(((await ok.json()) as { recent: unknown[] }).recent));
  // トークンの無い・違う要求は拒否する。
  assert.equal((await api({ headers: { 'Content-Type': 'application/json' }, body })).status, 403);
  assert.equal(
    (await api({ headers: { ...headers, 'X-Workbench-Token': token.replace(/./g, '0') }, body }))
      .status,
    403,
  );
  // 別のサイトからの要求 (Origin) と、別のホスト名宛て (DNS rebinding) は拒否する。
  assert.equal(
    (await api({ headers: { ...headers, Origin: 'http://evil.example' }, body })).status,
    403,
  );
  // fetch は Host ヘッダーを上書きできないので、生の HTTP 要求で別のホスト名宛てを送る。
  const rawStatus = (method: string, route: string): Promise<number | undefined> =>
    new Promise((resolve, reject) => {
      const request = http.request(
        `${origin}${route}`,
        { method, headers: { ...headers, Host: 'evil.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end(method === 'POST' ? body : undefined);
    });
  assert.equal(await rawStatus('POST', '/api'), 403);
  assert.equal(await rawStatus('GET', '/'), 403);
  assert.equal((await fetch(`${origin}/`)).status, 200);
  assert.equal((await fetch(`${origin}/other`)).status, 404);
  // プロジェクトの外のパスは、開いた後でも境界で止まる。
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-http-project-'));
  context.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const opened = (await (
    await api({ headers, body: JSON.stringify({ op: 'project-open', path: temp }) })
  ).json()) as { root: string };
  const outside = await api({
    headers,
    body: JSON.stringify({ op: 'read', root: opened.root, path: '../../etc/passwd' }),
  });
  assert.equal(outside.status, 400);
  assert.match(((await outside.json()) as { error: string }).error, /Not a file in this project/);
  // 上限を超える本文は 400 で、サーバーは生き続ける。
  const huge = await api({
    headers,
    body: `{"op":"project-list","pad":"${'x'.repeat(limits.requestBody + 1)}"}`,
  }).catch(() => undefined);
  if (huge) assert.equal(huge.status, 400);
  assert.equal((await api({ headers, body })).status, 200);
});
