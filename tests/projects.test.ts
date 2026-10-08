import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Projects } from '../server/projects.ts';
import type { Shell } from '../server/terminal.ts';

/** テストではログインシェルを起動しない。入出力の無いシェルで、セッションの管理だけを確かめる。 */
const noListeners = { dispose(): void {} };
const fakeShell = (): Shell => ({
  pid: -1,
  write(): void {},
  resize(): void {},
  kill(): void {},
  onData: () => noListeners,
  onExit: () => noListeners,
});

async function recentRoots(projects: Projects): Promise<string[]> {
  return (await projects.dispatch({ op: 'project-list' })).recent.map((project) => project.root);
}

test('starts without a project, persists recents, and isolates projects and terminals', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-projects-'));
  const directory = path.join(temp, 'state');
  const projects = new Projects({ directory, spawnShell: fakeShell });
  try {
    for (const name of ['one', 'two']) {
      fs.mkdirSync(path.join(temp, name));
      fs.writeFileSync(path.join(temp, name, 'README.md'), name);
    }
    assert.deepEqual(await recentRoots(projects), []);
    await assert.rejects(projects.dispatch({ op: 'workspace', root: temp }));
    const one = (await projects.dispatch({ op: 'project-open', path: path.join(temp, 'one') }))
      .root;
    const two = (await projects.dispatch({ op: 'project-open', path: path.join(temp, 'two') }))
      .root;
    assert.equal(
      (await projects.dispatch({ op: 'read', root: one, path: 'README.md' })).text,
      'one',
    );
    assert.equal(
      (await projects.dispatch({ op: 'read', root: two, path: 'README.md' })).text,
      'two',
    );
    const terminal = await projects.dispatch({ op: 'terminal-start', root: one });
    await assert.rejects(projects.dispatch({ op: 'terminal-read', root: two, id: terminal.id }));
    await projects.dispatch({ op: 'terminal-close', root: one, id: terminal.id });
    await projects.dispatch({ op: 'project-open', path: one });
    assert.deepEqual(await recentRoots(new Projects({ directory })), [one, two]);
    await assert.rejects(
      projects.dispatch({ op: 'project-open', path: path.join(temp, 'missing') }),
    );
    assert.deepEqual(await recentRoots(projects), [one, two]);
    const browsed = await projects.dispatch({ op: 'project-browse', path: temp });
    assert.ok(browsed.folders.some((folder) => folder.name === 'one'));
  } finally {
    projects.dispose();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('壊れた設定ファイルは保存を止めず、整形を省いた保存と警告にする', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-settings-file-'));
  context.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const directory = path.join(temp, 'state');
  const project = path.join(temp, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'main.ts'), 'export const value = 1;\n');
  const projects = new Projects({ directory, spawnShell: fakeShell });
  context.after(() => projects.dispose());
  const { root } = await projects.dispatch({ op: 'project-open', path: project });
  await projects.dispatch({ op: 'settings-set', root, formatOnSave: true });
  const [file] = fs.readdirSync(path.join(directory, 'settings'));
  const settingsFile = path.join(directory, 'settings', file);
  fs.writeFileSync(settingsFile, '{ broken');
  const document = await projects.dispatch({ op: 'read', root, path: 'main.ts' });
  const saved = await projects.dispatch({
    op: 'save',
    root,
    path: 'main.ts',
    text: 'export const value = 2;\n',
    revision: document.revision,
  });
  assert.equal(saved.text, 'export const value = 2;\n');
  assert.ok(saved.warning?.includes(settingsFile), saved.warning);
  // 設定画面では直すべきファイルを知らせ、勝手に上書きして元の内容を消さない。
  await assert.rejects(projects.dispatch({ op: 'settings-get', root }), (error: Error) =>
    error.message.includes(settingsFile),
  );
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{ broken');
});

test('使われていないワークスペースは解放し、ターミナルは残して次の要求で作り直す', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-idle-'));
  context.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const project = path.join(temp, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'main.ts'), 'export const value = 1;\n');
  const projects = new Projects({
    directory: path.join(temp, 'state'),
    spawnShell: fakeShell,
    idleRelease: 50,
  });
  context.after(() => projects.dispose());
  const { root } = await projects.dispatch({ op: 'project-open', path: project });
  const session = await projects.dispatch({ op: 'terminal-start', root });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(
    (await projects.dispatch({ op: 'terminal-list', root })).sessions.map((s) => s.id),
    [session.id],
  );
  assert.equal(
    (await projects.dispatch({ op: 'read', root, path: 'main.ts' })).text,
    'export const value = 1;\n',
  );
});

test('recents display only existing directories and preserve their order', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-recents-'));
  const projects = new Projects({ directory: path.join(temp, 'state') });
  context.after(() => {
    projects.dispose();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const keep = path.join(temp, 'keep');
  const moved = path.join(temp, 'moved');
  fs.mkdirSync(keep);
  fs.mkdirSync(moved);
  await projects.dispatch({ op: 'project-open', path: keep });
  await projects.dispatch({ op: 'project-open', path: moved });
  fs.renameSync(moved, path.join(temp, 'new-name'));
  assert.deepEqual(await recentRoots(projects), [fs.realpathSync(keep)]);
  fs.rmdirSync(keep);
  fs.writeFileSync(keep, 'This path is now a file.');
  assert.deepEqual(await recentRoots(projects), []);
});

test('a missing recents file means an empty list; a broken one reports which file to fix', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-recents-file-'));
  context.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const directory = path.join(temp, 'state');
  const project = path.join(temp, 'project');
  fs.mkdirSync(project);
  const projects = new Projects({ directory });
  context.after(() => projects.dispose());
  assert.deepEqual(await recentRoots(projects), []);
  await projects.dispatch({ op: 'project-open', path: project });
  const file = path.join(directory, 'projects.json');
  fs.writeFileSync(file, '{ not json');
  await assert.rejects(projects.dispatch({ op: 'project-list' }), (error: Error) =>
    error.message.includes(file),
  );
  // 読めない一覧は上書きしない。開けなかったプロジェクトは開いた状態にもならない。
  await assert.rejects(projects.dispatch({ op: 'project-open', path: project }));
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
  fs.writeFileSync(file, '[1]');
  await assert.rejects(
    projects.dispatch({ op: 'project-open', path: project }),
    (error: Error) => error.message.includes('Invalid input') && !error.message.includes('"code"'),
  );
  // まだ開いていないプロジェクトは、一覧の保存に失敗したら開いた状態にならない。
  const fresh = new Projects({ directory });
  context.after(() => fresh.dispose());
  await assert.rejects(fresh.dispatch({ op: 'project-open', path: project }));
  await assert.rejects(fresh.dispatch({ op: 'workspace', root: fs.realpathSync.native(project) }));
});

test('a missing home directory does not prevent opening a valid project', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-no-home-'));
  context.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const project = path.join(temp, 'project');
  fs.mkdirSync(project);
  const projects = new Projects({
    directory: path.join(temp, 'state'),
    home: path.join(temp, 'no-such-home'),
  });
  context.after(() => projects.dispose());
  assert.equal(
    (await projects.dispatch({ op: 'project-open', path: project })).root,
    fs.realpathSync(project),
  );
});

test('broad folders require confirmation before workspace creation or recent-history writes', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-broad-root-'));
  const directory = path.join(temp, 'state');
  const home = path.join(temp, 'home');
  fs.mkdirSync(home);
  const projects = new Projects({ directory, home });
  try {
    const alias = path.join(temp, 'home-link');
    fs.symlinkSync(home, alias);
    const realHome = fs.realpathSync(home);
    for (const input of [home, `${home}/..`, '/', '~', alias]) {
      const result = await projects.dispatch({ op: 'project-open', path: input });
      assert.equal(result.confirmationRequired, true);
      await assert.rejects(projects.dispatch({ op: 'workspace', root: result.root }));
      assert.deepEqual(await recentRoots(new Projects({ directory, home })), []);
      const other = await projects.dispatch({
        op: 'project-open',
        path: input,
        confirmedRoot: temp,
      });
      assert.equal(other.confirmationRequired, true);
    }
    const result = await projects.dispatch({
      op: 'project-open',
      path: home,
      confirmedRoot: realHome,
    });
    assert.equal(result.root, realHome);
    assert.equal(result.confirmationRequired, undefined);
    assert.equal((await projects.dispatch({ op: 'workspace', root: realHome })).root, realHome);
  } finally {
    projects.dispose();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('forgetting a recent project preserves its files and is persisted', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-forget-'));
  const root = path.join(temp, 'project');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'keep.txt'), 'keep');
  const directory = path.join(temp, 'state');
  const projects = new Projects({ directory });
  try {
    await projects.dispatch({ op: 'project-open', path: root });
    const forgotten = await projects.dispatch({
      op: 'project-forget',
      path: fs.realpathSync(root),
    });
    assert.equal(forgotten.recent.length, 0);
    assert.deepEqual(await recentRoots(new Projects({ directory })), []);
    assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'keep');
  } finally {
    projects.dispose();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('folder exclusions persist per project and refresh without discarding open buffers', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-excludes-'));
  const directory = path.join(temp, 'state');
  const projects = new Projects({ directory });
  const reopened = new Projects({ directory });
  context.after(() => {
    projects.dispose();
    reopened.dispose();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  for (const folder of ['one/.shinaps/work', 'one/src/cache', 'one/cache', 'two/.shinaps']) {
    fs.mkdirSync(path.join(temp, folder), { recursive: true });
    fs.writeFileSync(path.join(temp, folder, 'note.ts'), 'const value = 1;');
  }
  const root = (await projects.dispatch({ op: 'project-open', path: path.join(temp, 'one') })).root;
  const other = (await projects.dispatch({ op: 'project-open', path: path.join(temp, 'two') }))
    .root;
  assert.ok((await projects.dispatch({ op: 'workspace', root })).directories.includes('.shinaps'));
  await projects.dispatch({
    op: 'settings-set',
    root,
    excludedPaths: ['.shinaps/work', 'cache'],
  });
  const visible = await projects.dispatch({ op: 'workspace', root });
  assert.deepEqual(visible.directories.sort(), ['.shinaps', 'src']);
  assert.equal(visible.files.length, 0);
  assert.ok(
    (await projects.dispatch({ op: 'workspace', root: other })).directories.includes('.shinaps'),
  );
  await projects.dispatch({ op: 'settings-set', root, excludedPaths: [] });
  assert.equal(
    (
      await projects.dispatch({
        op: 'workspace',
        root,
        expanded: ['.shinaps/work', 'src/cache', 'cache'],
      })
    ).files.length,
    3,
  );
  await projects.dispatch({
    op: 'sync',
    root,
    documents: [{ path: 'cache/note.ts', text: 'const value: number = "unsaved";' }],
  });
  const diagnostics = await projects.dispatch({ op: 'diagnostics', root, path: 'cache/note.ts' });
  assert.ok(diagnostics.diagnostics.length > 0);
  await projects.dispatch({ op: 'settings-set', root, excludedPaths: ['cache'] });
  await projects.dispatch({ op: 'workspace', root });
  assert.deepEqual(
    await projects.dispatch({ op: 'diagnostics', root, path: 'cache/note.ts' }),
    diagnostics,
  );
  // 一部の項目だけを更新しても、ほかの設定 (excludedPaths) が保たれることを確かめる。
  await projects.dispatch({ op: 'settings-set', root, formatOnSave: true });
  await reopened.dispatch({ op: 'project-open', path: root });
  assert.deepEqual((await reopened.dispatch({ op: 'settings-get', root })).excludedPaths, [
    'cache',
  ]);
  assert.ok(!(await reopened.dispatch({ op: 'workspace', root })).directories.includes('cache'));
});

test('analysis exclusions keep files editable and suppress diagnostics and semantic results', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-analysis-excludes-'));
  const directory = path.join(temp, 'state');
  const projects = new Projects({ directory });
  context.after(() => {
    projects.dispose();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const folder = path.join(temp, 'project');
  fs.mkdirSync(path.join(folder, 'nested/cache'), { recursive: true });
  fs.mkdirSync(path.join(folder, 'cache'));
  const errorSource = 'export const value: number = "wrong";';
  const mainSource = 'import { value } from "./cache/error"; console.log(value);';
  // 識別子の位置は本文から求め、fixture を変えても同じ識別子を指すようにする。
  const valueInError = errorSource.indexOf('value');
  const valueInMain = mainSource.indexOf('value');
  fs.writeFileSync(path.join(folder, 'cache/error.ts'), errorSource);
  fs.writeFileSync(
    path.join(folder, 'nested/cache/error.ts'),
    'export const other: number = "wrong";',
  );
  fs.writeFileSync(path.join(folder, 'main.ts'), mainSource);
  const root = (await projects.dispatch({ op: 'project-open', path: folder })).root;
  assert.ok(
    (await projects.dispatch({ op: 'diagnostics', root, path: 'main.ts' })).diagnostics.some(
      (item) => item.path === 'cache/error.ts',
    ),
  );
  await projects.dispatch({ op: 'settings-set', root, analysisExcludedPaths: ['./cache'] });
  const tree = await projects.dispatch({ op: 'workspace', root, expanded: ['cache'] });
  assert.ok(tree.files.includes('cache/error.ts'));
  const result = await projects.dispatch({ op: 'diagnostics', root, path: 'main.ts' });
  assert.ok(!result.diagnostics.some((item) => item.path === 'cache/error.ts'));
  assert.ok(result.diagnostics.some((item) => item.path === 'nested/cache/error.ts'));
  assert.deepEqual(await projects.dispatch({ op: 'diagnostics', root, path: 'cache/error.ts' }), {
    diagnostics: [],
    scope: null,
  });
  assert.deepEqual(
    await projects.dispatch({ op: 'hover', root, path: 'cache/error.ts', position: valueInError }),
    { info: null },
  );
  assert.deepEqual(
    await projects.dispatch({ op: 'definition', root, path: 'main.ts', position: valueInMain }),
    { locations: [] },
  );
  const doc = await projects.dispatch({ op: 'read', root, path: 'cache/error.ts' });
  await projects.dispatch({
    op: 'save',
    root,
    path: doc.path,
    revision: doc.revision,
    text: 'export const value = 42;',
  });
  assert.equal(
    fs.readFileSync(path.join(folder, 'cache/error.ts'), 'utf8'),
    'export const value = 42;',
  );
  await projects.dispatch({ op: 'settings-set', root, excludedPaths: ['./main.ts'] });
  assert.ok(!(await projects.dispatch({ op: 'workspace', root })).files.includes('main.ts'));
  await projects.dispatch({ op: 'settings-set', root, analysisExcludedPaths: [] });
  await projects.dispatch({ op: 'workspace', root });
  assert.notEqual(
    (await projects.dispatch({ op: 'hover', root, path: 'cache/error.ts', position: valueInError }))
      .info,
    null,
  );
});
