import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import { Workspace } from '../server/workspace.ts';

// 2345: 引数の型が合わない、2322: 代入の型が合わない。
const typescriptCode = { argumentType: 2345, assignment: 2322 };
// ファイルの終端より後ろの位置。言語サービスは範囲外の位置を拒否せず、該当なしとして扱う。
const beyondEnd = 100;

function fixture(context: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-'));
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: 'ESNext',
        moduleResolution: 'Bundler',
        target: 'ES2022',
      },
      include: ['*.ts'],
    }),
  );
  fs.writeFileSync(
    path.join(root, 'math.ts'),
    'export function twice(value: number): number { return value * 2; }\n',
  );
  fs.writeFileSync(
    path.join(root, 'main.ts'),
    'import { twice } from "./math";\nconst result: number = twice(21);\n',
  );
  const workspace = new Workspace(root);
  context.after(() => {
    workspace.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { workspace, root };
}

test('semantic navigation resolves cross-file symbols and includes their references', (context) => {
  const { workspace } = fixture(context);
  const file = workspace.read('main.ts');
  const position = file.text.lastIndexOf('twice') + 2;
  assert.equal(workspace.definition('main.ts', position).locations[0].path, 'math.ts');
  const references = workspace.references('main.ts', position);
  assert.ok(
    references.locations.some((location) => location.path === 'main.ts' && location.line === 2),
  );
  assert.match(workspace.hover('main.ts', position).info?.signature ?? '', /value: number/);
  assert.deepEqual(workspace.hover('main.ts', file.text.length + beyondEnd), { info: null });
});

test('diagnostics reflect unsaved buffers and recover after correcting them', (context) => {
  const { workspace } = fixture(context);
  const before = workspace.read('main.ts');
  workspace.sync([{ path: 'main.ts', text: before.text.replace('twice(21)', 'twice("bad")') }]);
  assert.ok(
    workspace
      .diagnostics('main.ts')
      .diagnostics.some(
        (diagnostic) =>
          diagnostic.path === 'main.ts' && diagnostic.code === typescriptCode.argumentType,
      ),
  );
  assert.equal(workspace.read('main.ts').text, before.text);
  workspace.sync([{ path: 'main.ts', text: before.text }]);
  assert.deepEqual(workspace.diagnostics('main.ts').diagnostics, []);
});

test('replacing editor buffers clears stale state after reconnect', (context) => {
  const { workspace } = fixture(context);
  workspace.sync([
    { path: 'math.ts', text: 'export function twice(value: string): string { return value; }' },
  ]);
  assert.ok(workspace.diagnostics('main.ts').diagnostics.length > 0);
  workspace.sync([{ path: 'main.ts', text: workspace.read('main.ts').text }]);
  assert.deepEqual(workspace.diagnostics('main.ts').diagnostics, []);
});

test('language service observes external edits without recreating the project', (context) => {
  const { workspace, root } = fixture(context);
  assert.deepEqual(workspace.diagnostics('main.ts').diagnostics, []);
  fs.writeFileSync(
    path.join(root, 'math.ts'),
    'export function twice(value: string): string { return value; }',
  );
  assert.ok(
    workspace
      .diagnostics('main.ts')
      .diagnostics.some((diagnostic) => diagnostic.path === 'main.ts'),
  );
});

test('save preserves external changes on revision conflict; retry requires new disk revision', (context) => {
  const { workspace, root } = fixture(context);
  const before = workspace.read('main.ts');
  fs.writeFileSync(path.join(root, 'main.ts'), '// external edit\n');
  assert.throws(
    () => workspace.save('main.ts', '// my edit\n', before.revision),
    /changed on disk/,
  );
  assert.equal(workspace.read('main.ts').text, '// external edit\n');
  const current = workspace.read('main.ts');
  const saved = workspace.save('main.ts', '// merged\n', current.revision);
  assert.equal(saved.text, '// merged\n');
  assert.notEqual(saved.revision, current.revision);
});

test('project boundary rejects path traversal and symlink escapes', (context) => {
  const { workspace, root } = fixture(context);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'secret.ts'), 'secret');
  fs.symlinkSync(path.join(outside, 'secret.ts'), path.join(root, 'escape.ts'));
  assert.throws(() => workspace.read('escape.ts'));
  assert.throws(() => workspace.read(path.relative(root, path.join(outside, 'secret.ts'))));
});

test('repository tree includes text and empty directories while semantics follow nearest config', (context) => {
  const { workspace, root } = fixture(context);
  fs.mkdirSync(path.join(root, 'apps/strict/empty'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps/loose'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/ignored'), { recursive: true });
  for (const [name, strictNullChecks] of [
    ['strict', true],
    ['loose', false],
  ] as const) {
    fs.writeFileSync(
      path.join(root, `apps/${name}/tsconfig.json`),
      JSON.stringify({ compilerOptions: { strictNullChecks, types: [] } }),
    );
    fs.writeFileSync(path.join(root, `apps/${name}/index.ts`), 'const value: string = null;');
  }
  fs.writeFileSync(path.join(root, 'README.md'), '# Project\n');
  // NUL を含むファイルはバイナリとして扱う。
  fs.writeFileSync(path.join(root, 'image.bin'), Buffer.from([0, 255]));
  const tree = workspace.rescan();
  assert.ok(tree.files.includes('README.md'));
  assert.ok(tree.directories.includes('apps/strict/empty'));
  assert.ok(!tree.directories.includes('node_modules'));
  assert.equal(workspace.read('README.md').text, '# Project\n');
  assert.throws(() => workspace.read('image.bin'), /binary/);
  assert.equal(workspace.diagnostics('README.md').scope, null);
  assert.ok(
    workspace
      .diagnostics('apps/strict/index.ts')
      .diagnostics.some((diagnostic) => diagnostic.code === typescriptCode.assignment),
  );
  assert.deepEqual(workspace.diagnostics('apps/loose/index.ts').diagnostics, []);
});

// include の外のファイルを 1 つの言語サービスで共有すると、先に開いたファイルのエラーが別のファイルの診断に混ざったり、
// 開いた順番で診断の結果が変わったりする。
test('diagnostics of a file outside the config include depend only on that file', (context) => {
  const { workspace, root } = fixture(context);
  fs.mkdirSync(path.join(root, 'extra'));
  fs.writeFileSync(path.join(root, 'extra/a.ts'), 'export const a: number = "a";\n');
  fs.writeFileSync(path.join(root, 'extra/b.ts'), 'export const b: string = 1;\n');
  const direct = workspace.diagnostics('extra/a.ts');
  assert.ok(direct.diagnostics.length > 0);
  assert.ok(direct.diagnostics.every((diagnostic) => diagnostic.path === 'extra/a.ts'));
  workspace.diagnostics('extra/b.ts');
  assert.deepEqual(workspace.diagnostics('extra/a.ts'), direct);
  assert.ok(
    workspace
      .diagnostics('main.ts')
      .diagnostics.every((diagnostic) => !diagnostic.path.startsWith('extra/')),
  );
});

test('unreadable descendants do not block readable files, but an unreadable root fails', (context) => {
  const { workspace, root } = fixture(context);
  const cloud = path.join(root, 'cloud');
  fs.mkdirSync(cloud);
  fs.mkdirSync(path.join(root, '.build'));
  fs.writeFileSync(path.join(root, '.build', 'generated.ts'), '');
  fs.chmodSync(cloud, 0o000);
  try {
    const result = workspace.rescan();
    assert.ok(result.files.includes('main.ts'));
    assert.deepEqual(result.unreadableDirectories, ['cloud']);
    assert.ok(!result.files.some((file) => file.startsWith('.build/')));
    fs.chmodSync(root, 0o000);
    assert.throws(() => workspace.rescan(), /EACCES/);
  } finally {
    fs.chmodSync(root, 0o700);
    fs.chmodSync(cloud, 0o700);
  }
});

test('size limits apply per content kind and are checked before the file is read', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-limits-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const megabyte = 1024 * 1024;
  // readFileSync は 2 GiB を超えるファイルを読めない。stat で先に拒否していれば上限の文言になる。
  // 疎なファイルなのでディスクは消費しない。
  const sparse = (file: string, size: number): void => {
    fs.writeFileSync(file, '');
    fs.truncateSync(file, size);
  };
  // 画像はテキストの上限 (2 MB) を超えても画像の上限 (10 MB) までは読める。
  fs.writeFileSync(path.join(root, 'large.png'), Buffer.alloc(3 * megabyte, 1));
  sparse(path.join(root, 'huge.png'), 3 * 1024 * megabyte);
  sparse(path.join(root, 'huge.txt'), 3 * 1024 * megabyte);
  const workspace = new Workspace(root);
  context.after(() => workspace.dispose());
  assert.match(workspace.imageRead('large.png').src, /^data:image\/png;base64,/);
  assert.throws(() => workspace.imageRead('huge.png'), /Image preview supports files up to 10 MB/);
  assert.throws(() => workspace.read('huge.txt'), /Files over 2 MB/);
});

test('a byte order mark stays out of the text and positions, and returns to disk on save', (context) => {
  const { workspace, root } = fixture(context);
  const bytes = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('const bom: number = "x";\n'),
  ]);
  fs.writeFileSync(path.join(root, 'bom.ts'), bytes);
  const document = workspace.read('bom.ts');
  // Monaco は先頭の BOM を落とすので、本文と診断の桁はエディタのモデルと同じ形で返す。
  assert.equal(document.text.startsWith('\ufeff'), false);
  const [diagnostic] = workspace.diagnostics('bom.ts').diagnostics;
  assert.deepEqual([diagnostic?.line, diagnostic?.column], [1, 7]);
  const saved = workspace.save('bom.ts', document.text, document.revision);
  assert.equal(saved.revision, document.revision);
  assert.deepEqual(fs.readFileSync(path.join(root, 'bom.ts')), bytes);
});

test('paths that are not files in the project fail with one message, and spellings resolve to one file', (context) => {
  const { workspace, root } = fixture(context);
  for (const relative of ['', '.', 'missing.ts', 'a\0b', root])
    assert.throws(() => workspace.read(relative), /Not a file in this project/);
  // 大小文字を区別しないファイルシステムでは、綴り違いも同じ実体 (同じ overlay) に解決する。
  const insensitive = fs.existsSync(path.join(root, 'MAIN.TS'));
  if (!insensitive) return;
  workspace.sync([{ path: 'MAIN.TS', text: 'const wrong: number = "x";' }]);
  assert.equal(workspace.diagnostics('main.ts').diagnostics.length, 1);
});

test('sync skips documents whose file disappeared and replaces the set all at once', (context) => {
  const { workspace, root } = fixture(context);
  const broken = 'const wrong: number = "x";';
  workspace.sync([{ path: 'main.ts', text: broken }]);
  fs.unlinkSync(path.join(root, 'math.ts'));
  workspace.sync([
    { path: 'main.ts', text: broken },
    { path: 'math.ts', text: 'export const gone = 1;' },
  ]);
  assert.equal(workspace.diagnostics('main.ts').diagnostics.length, 1);
});

test('a tsconfig files entry that does not exist does not block the other files', (context) => {
  const { workspace, root } = fixture(context);
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, files: ['main.ts', 'missing.ts'] }),
  );
  workspace.rescan();
  assert.deepEqual(workspace.diagnostics('main.ts').diagnostics, []);
});

test('image preview preserves bytes and respects the workspace boundary', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-images-'));
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII=',
    'base64',
  );
  fs.writeFileSync(path.join(root, 'sample.png'), bytes);
  const workspace = new Workspace(root);
  try {
    assert.equal(
      workspace.imageRead('sample.png').src,
      `data:image/png;base64,${bytes.toString('base64')}`,
    );
    assert.deepEqual(fs.readFileSync(path.join(root, 'sample.png')), bytes);
    assert.throws(() => workspace.imageRead('../outside.png'));
  } finally {
    workspace.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
