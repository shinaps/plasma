import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import { gitDiff, gitStatus } from '../server/git.ts';
import { gitCommit, gitCommitDiff, gitHistory } from '../server/git-history.ts';
import { Workspace } from '../server/workspace.ts';

const wholeHistory = { revisions: ['HEAD'], query: '', skip: 0 };

function fixture(context: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-git-'));
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const write = (file: string, text: string | Buffer): void => {
    fs.writeFileSync(path.join(root, file), text);
  };
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  write('file with spaces.ts', 'export const value = 1;\n');
  write('deleted.txt', 'deleted\n');
  git('add', '.');
  git('commit', '-m', 'fixture');
  const workspace = new Workspace(root);
  context.after(() => {
    workspace.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });
  // Workspace はシンボリックリンクを解決した実体パスを root にする。git の出力と比べるときは同じ形で持つ。
  return { workspace, git, write, root: workspace.root };
}

test('Git comparisons distinguish HEAD, index and working tree without modifying them', (context) => {
  const { workspace, git, write, root } = fixture(context);
  write('file with spaces.ts', 'export const value = 2;\n');
  git('add', 'file with spaces.ts');
  write('file with spaces.ts', 'export const value = 3;\n');
  const before = git('status', '--porcelain');
  const state = gitStatus(root);
  assert.equal(state.branch, 'main');
  assert.equal(state.entries[0].index, 'M');
  assert.equal(state.entries[0].working, 'M');
  for (const [mode, left, right] of [
    ['all', 1, 3],
    ['working', 2, 3],
    ['staged', 1, 2],
  ] as const) {
    const diff = gitDiff(workspace, 'file with spaces.ts', mode);
    assert.match(diff.original, new RegExp(`= ${left}`));
    assert.match(diff.modified, new RegExp(`= ${right}`));
  }
  assert.equal(git('status', '--porcelain'), before);
});

test('Git diff handles renamed, deleted and untracked files, and refuses unrelated paths', (context) => {
  const { workspace, git, write, root } = fixture(context);
  git('mv', 'file with spaces.ts', 'renamed.ts');
  fs.unlinkSync(path.join(root, 'deleted.txt'));
  write('new.txt', 'new\n');
  const renamed = gitDiff(workspace, 'renamed.ts', 'all');
  assert.match(renamed.original, /value = 1/);
  assert.equal(renamed.editable, true);
  assert.equal(gitDiff(workspace, 'deleted.txt', 'all').modified, '');
  assert.equal(gitDiff(workspace, 'new.txt', 'all').original, '');
  assert.throws(() => gitDiff(workspace, '../outside', 'all'));
  // intent-to-add (git add -N) は HEAD に無いので、HEAD 側は空。
  write('intent.txt', 'intent\n');
  git('add', '-N', 'intent.txt');
  assert.equal(gitDiff(workspace, 'intent.txt', 'all').original, '');
  // NUL を含むファイルはバイナリとして扱う。
  const binaryBytes = Buffer.from([0, 255]);
  write('binary.bin', binaryBytes);
  assert.throws(() => gitDiff(workspace, 'binary.bin', 'all'), /binary|2 MB/);
});

test('git failures surface only the git message, and nested repositories stay out of the change list', (context) => {
  const { git, root } = fixture(context);
  assert.throws(
    () => gitCommit(root, 'no-such-ref'),
    (error: Error) => error.message.startsWith('fatal:') && !error.message.includes(root),
  );
  // 入れ子のリポジトリは git status にディレクトリとして現れる。差分を出せないので一覧に載せない。
  const inner = path.join(root, 'nested');
  fs.mkdirSync(inner);
  execFileSync('git', ['-C', inner, 'init', '-q']);
  fs.writeFileSync(path.join(inner, 'change.txt'), 'x');
  assert.equal(git('status', '--porcelain').includes('nested/'), true);
  assert.equal(
    gitStatus(root).entries.some((entry) => entry.path.startsWith('nested')),
    false,
  );
});

test('Git status reports repositories without an initial commit and non-Git directories', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-empty-'));
  const workspace = new Workspace(root);
  context.after(() => {
    workspace.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });
  assert.equal(gitStatus(root).available, false);
  assert.throws(() => gitHistory(root, wholeHistory));
  execFileSync('git', ['-C', root, 'init', '-b', 'main'], { stdio: 'ignore' });
  assert.deepEqual(gitHistory(root, wholeHistory).commits, []);
  fs.writeFileSync(path.join(root, 'new.txt'), 'first');
  execFileSync('git', ['-C', root, 'add', '.']);
  assert.equal(gitDiff(workspace, 'new.txt', 'staged').original, '');
});

// 信用できないリポジトリ (展開した zip など) を開いただけで、その .git/config に書かれたコマンドが
// 自動の git status から実行されると、任意のコードが動くことになる。
test('automatic status never runs commands configured inside the opened repository', (context) => {
  const { git, root } = fixture(context);
  const marker = path.join(root, 'fsmonitor-ran');
  git('config', 'core.fsmonitor', `sh -c 'touch "${marker}"'`);
  gitStatus(root);
  assert.equal(fs.existsSync(marker), false);
});

test('history compares immutable commits, including roots, renames and deletions', (context) => {
  const { git, write, root } = fixture(context);
  const first = git('rev-parse', 'HEAD').trim();
  const initial = gitCommitDiff(root, first, 'deleted.txt');
  assert.equal(initial.original, '');
  assert.equal(initial.modified, 'deleted\n');
  git('mv', 'file with spaces.ts', 'renamed.ts');
  git('rm', 'deleted.txt');
  git('commit', '-m', 'Rename and delete');
  const second = git('rev-parse', 'HEAD').trim();
  write('renamed.ts', 'not committed');
  const before = git('status', '--porcelain');
  const log = gitHistory(root, wholeHistory);
  assert.deepEqual(
    log.commits.map((commit) => commit.id),
    [second, first],
  );
  assert.equal(log.commits[0].subject, 'Rename and delete');
  assert.equal(log.commits[0].author, 'Fixture');
  assert.equal(log.hasMore, false);
  assert.ok(log.refs.includes('refs/heads/main'));
  const renamed = gitCommitDiff(root, second, 'renamed.ts');
  assert.equal(renamed.original, renamed.modified);
  assert.match(renamed.modified, /value = 1/);
  assert.equal(gitCommitDiff(root, second, 'deleted.txt').modified, '');
  assert.equal(gitHistory(root, { ...wholeHistory, query: 'rename' }).commits.length, 1);
  assert.throws(() => gitCommitDiff(root, second, '../outside'));
  assert.throws(() => gitCommit(root, '--all'));
  assert.equal(git('status', '--porcelain'), before);
  assert.equal(fs.readFileSync(path.join(root, 'renamed.ts'), 'utf8'), 'not committed');
});

test('history handles empty repositories and scopes commits to the opened subdirectory', (context) => {
  const { git, write, root } = fixture(context);
  fs.mkdirSync(path.join(root, 'nested'));
  write('nested/inside.txt', 'inside');
  git('add', '.');
  git('commit', '-m', 'Nested change');
  const nested = path.join(root, 'nested');
  const log = gitHistory(nested, wholeHistory);
  assert.equal(log.commits.length, 1);
  const detail = gitCommit(nested, log.tips[0]);
  assert.deepEqual(
    detail.entries.map((entry) => entry.path),
    ['inside.txt'],
  );
  assert.equal(gitCommitDiff(nested, log.tips[0], 'inside.txt').modified, 'inside');
  write('deleted.txt', 'outside-only change');
  git('add', '.');
  git('commit', '-m', 'Outside only');
  write('nested/inside.txt', 'second inside change');
  git('add', '.');
  git('commit', '-m', 'Second nested change');
  const scoped = gitHistory(nested, wholeHistory);
  assert.equal(scoped.commits.length, 2);
  assert.deepEqual(scoped.commits[0].parents, [scoped.commits[1].id]);
  assert.deepEqual(scoped.commits[1].parents, []);
  git('checkout', '--orphan', 'empty');
  git('rm', '-rf', '.');
  // まだコミットのないブランチでは、他のブランチの履歴を見せない。
  assert.deepEqual(gitHistory(root, wholeHistory).commits, []);
});

test('history pagination pins a revision and merge details compare the first parent', (context) => {
  const { git, write, root } = fixture(context);
  git('checkout', '-b', 'feature');
  write('feature.txt', 'feature');
  git('add', '.');
  git('commit', '-m', 'Feature work');
  git('checkout', 'main');
  write('main.txt', 'main');
  git('add', '.');
  git('commit', '-m', 'Main work');
  const parent = git('rev-parse', 'HEAD').trim();
  git('merge', '--no-ff', 'feature', '-m', 'Merge feature');
  const merged = gitCommit(root, 'HEAD');
  assert.equal(merged.parent, parent);
  assert.deepEqual(
    merged.entries.map((entry) => entry.path),
    ['feature.txt'],
  );
  assert.equal(gitCommitDiff(root, merged.id, 'feature.txt').modified, 'feature');
  // 1 ページに収まらない数のコミットを、作業ツリーに触れずに作る。
  const existing = gitHistory(root, wholeHistory).commits.length;
  const generated = { count: 60 };
  const tree = git('rev-parse', 'HEAD^{tree}').trim();
  let id = merged.id;
  for (let i = 0; i < generated.count; i++)
    id = git('commit-tree', tree, '-p', id, '-m', `Page ${i}`).trim();
  git('update-ref', 'refs/heads/pages', id);
  const first = gitHistory(root, {
    ...wholeHistory,
    revisions: ['refs/heads/pages', 'refs/heads/feature'],
  });
  assert.ok(first.commits.length < existing + generated.count);
  assert.equal(first.hasMore, true);
  // 2 ページ目を取る前にブランチへ新しいコミットが入っても、tip を指定していれば skip の位置がずれず、
  // 重複も抜けも起きない。ref 名で取り直すとずれる。
  git('update-ref', 'refs/heads/pages', git('commit-tree', tree, '-p', id, '-m', 'New tip').trim());
  git('update-ref', 'refs/heads/main', id);
  const next = gitHistory(root, {
    ...wholeHistory,
    revisions: first.tips,
    compareRef: first.comparison?.ref,
    compareTip: first.comparison?.tip,
    skip: first.commits.length,
  });
  assert.deepEqual(next.comparison, first.comparison);
  assert.equal(next.hasMore, false);
  assert.equal(
    new Set([...first.commits, ...next.commits].map((commit) => commit.id)).size,
    existing + generated.count,
  );
});

test('image diffs preserve revision bytes across working tree, index and history', (context) => {
  const { workspace, git, write, root } = fixture(context);
  const pngSignature = [137, 80, 78, 71];
  const original = Buffer.from([...pngSignature, 0, 1]);
  const staged = Buffer.from([...pngSignature, 0, 2]);
  const working = Buffer.from([...pngSignature, 0, 3]);
  const uri = (bytes: Buffer): string => `data:image/png;base64,${bytes.toString('base64')}`;
  write('image.png', original);
  git('add', 'image.png');
  git('commit', '-m', 'add image');
  write('image.png', staged);
  git('add', 'image.png');
  write('image.png', working);
  const all = gitDiff(workspace, 'image.png', 'all');
  assert.equal(all.original, uri(original));
  assert.equal(all.modified, uri(working));
  assert.equal(all.editable, false);
  assert.equal(all.image, true);
  const index = gitDiff(workspace, 'image.png', 'staged');
  assert.equal(index.modified, uri(staged));
  git('commit', '-m', 'update image');
  const history = gitCommitDiff(root, 'HEAD', 'image.png');
  assert.equal(history.original, uri(original));
  assert.equal(history.modified, uri(staged));
});

test('複数ブランチの履歴を重複なく統合し、比較元への到達可能性で追加分を区別する', (context) => {
  const { git, root } = fixture(context);
  const common = git('rev-parse', 'HEAD').trim();
  const tree = git('rev-parse', 'HEAD^{tree}').trim();
  const base = git('commit-tree', tree, '-p', common, '-m', 'Main update').trim();
  const feature = git('commit-tree', tree, '-p', common, '-m', 'Feature update').trim();
  git('update-ref', 'refs/remotes/origin/main', base);
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git('update-ref', 'refs/heads/feature', feature);
  git('checkout', 'feature');
  const initial = gitHistory(root, { ...wholeHistory, revisions: [] });
  assert.deepEqual(initial.selection, ['HEAD', 'refs/remotes/origin/main']);
  assert.deepEqual(new Set(initial.commits.map((c) => c.id)), new Set([base, feature, common]));
  assert.equal(initial.comparison?.tip, base);
  assert.equal(initial.comparison?.outsideCount, 1);
  assert.deepEqual(
    initial.commits.filter((c) => c.outsideBase).map((c) => c.id),
    [feature],
  );
  const filtered = gitHistory(root, {
    ...wholeHistory,
    revisions: initial.selection,
    query: 'Main',
  });
  assert.equal(filtered.comparison?.outsideCount, 1);
  assert.equal(filtered.commits[0].outsideBase, false);
  const merged = git('commit-tree', tree, '-p', base, '-p', feature, '-m', 'Merge feature').trim();
  git('update-ref', 'refs/remotes/origin/main', merged);
  const refreshed = gitHistory(root, { ...wholeHistory, revisions: initial.selection });
  assert.equal(refreshed.comparison?.outsideCount, 0);
  assert.ok(refreshed.commits.every((c) => !c.outsideBase));
  // 両方の先端を固定すれば途中の更新でページ間の分類・集合が変わらない。
  const pinned = gitHistory(root, {
    ...wholeHistory,
    revisions: initial.tips,
    compareRef: initial.comparison?.ref,
    compareTip: base,
  });
  assert.deepEqual(
    pinned.commits,
    initial.commits.map((c) => ({
      ...c,
      decorations: pinned.commits.find((p) => p.id === c.id)?.decorations,
    })),
  );
  assert.equal(pinned.comparison?.outsideCount, 1);
  const switched = gitHistory(root, {
    ...wholeHistory,
    revisions: initial.selection,
    compareRef: 'refs/heads/feature',
  });
  assert.equal(switched.comparison?.outsideCount, 2);
  assert.throws(() => gitHistory(root, { ...wholeHistory, revisions: ['--all'] }));
  assert.throws(() => gitHistory(root, { ...wholeHistory, compareRef: '--all' }));
});
