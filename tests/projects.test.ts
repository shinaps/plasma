import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Projects } from '../server/projects.ts';

async function recentRoots(projects: Projects): Promise<string[]> {
  return (await projects.dispatch({ op: 'project-list' })).recent.map((project) => project.root);
}

test('starts without a project, persists recents, and isolates projects and terminals', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-projects-'));
  const directory = path.join(temp, 'state');
  const projects = new Projects({ directory });
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
