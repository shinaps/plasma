import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import { commitFiles, gitStatus } from '../server/git.ts';
import { outline } from '../server/outline.ts';
import { commitSelection } from '../server/partial-commit.ts';
import { selectedContent } from '../shared/partial-changes.ts';

// 利用者のグローバル設定 (commit.gpgsign や filter の定義) に左右されないよう、空の設定だけを使う。
process.env.GIT_CONFIG_GLOBAL = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-gitconfig-')),
  'gitconfig',
);
process.env.GIT_CONFIG_NOSYSTEM = '1';

const before = 'first\nkeep1\nkeep2\nkeep3\nlast\n';
const after = 'FIRST\nkeep1\nkeep2\nkeep3\nLAST\n';

function fixture(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-partial-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const write = (file: string, text: string): void => {
    fs.writeFileSync(path.join(root, file), text);
  };
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  write('a.ts', before);
  write('b.ts', 'before');
  git('add', '.');
  git('commit', '-m', 'initial');
  return { root, git, write };
}

test('選択した差分だけをコミットし、作業内容と無関係なステージを保持する', (t) => {
  const { root, git } = fixture(t);
  fs.writeFileSync(path.join(root, 'a.ts'), before.replace('last', 'LAST'));
  fs.writeFileSync(path.join(root, 'b.ts'), 'staged');
  git('add', '.');
  fs.writeFileSync(path.join(root, 'a.ts'), after);
  const result = commitSelection(root, ['a.ts'], 'partial', [
    { path: 'a.ts', before, after, changes: [0] },
  ]);
  assert.equal(git('show', `${result.hash}:a.ts`), before.replace('first', 'FIRST'));
  assert.equal(fs.readFileSync(path.join(root, 'a.ts'), 'utf8'), after);
  assert.equal(git('show', ':a.ts'), after);
  assert.equal(git('show', ':b.ts'), 'staged');
  assert.equal(git('show', 'HEAD:b.ts'), 'before');
  const state = git('status', '--porcelain');
  assert.throws(
    () => commitSelection(root, ['a.ts'], 'stale', [{ path: 'a.ts', before, after, changes: [1] }]),
    /changed since selection/,
  );
  assert.equal(git('status', '--porcelain'), state);
  assert.equal(git('rev-parse', 'HEAD').trim(), result.hash);
  assert.equal(fs.existsSync(path.join(root, '.git/index.lock')), false);
  // コミットが失敗したときに一時 index や index.lock が残ると、利用者の通常の git 操作ができなくなり、
  // ステージ内容も失われる。
  fs.writeFileSync(path.join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', {
    mode: 0o755,
  });
  assert.throws(() =>
    commitSelection(root, ['a.ts'], 'fail', [
      { path: 'a.ts', before: before.replace('first', 'FIRST'), after, changes: [0] },
    ]),
  );
  assert.equal(git('rev-parse', 'HEAD').trim(), result.hash);
  assert.equal(git('status', '--porcelain'), state);
  assert.equal(fs.existsSync(path.join(root, '.git/index.lock')), false);
});

test('差分選択は改行形式と末尾改行を保持する', () => {
  for (const eol of ['\n', '\r\n']) {
    const a = before.replaceAll('\n', eol),
      b = after.replaceAll('\n', eol);
    assert.equal(selectedContent(a, b, [0, 1]), b);
    assert.equal(selectedContent(a, b, [1]), a.replace('last', 'LAST'));
  }
  assert.equal(selectedContent('a\nb', 'a\nb\n', [0]), 'a\nb\n');
  assert.equal(selectedContent('a\nb\n', 'a\nb', [0]), 'a\nb');
  assert.equal(selectedContent('a\nb\n', 'a\nb\nc\n', [0]), 'a\nb\nc\n');
});

test('選ばなかった行には改行コードの変換を混ぜず、改行だけの変更は選べない', () => {
  // 作業ツリー全体が CRLF に変わっていても、選んだ単位以外は HEAD の改行のまま残す。
  assert.equal(selectedContent('a\nb\n', 'a\r\nb\r\nc\r\n', [0]), 'a\nb\r\nc\r\n');
  assert.equal(selectedContent('a\nb\nc\n', 'A\r\nb\r\nc\r\n', [0]), 'A\r\nb\nc\n');
  assert.equal(selectedContent('a\r\nb\n', 'a\r\nb\nc', [0]), 'a\r\nb\nc');
  assert.throws(() => selectedContent('a\nb\n', 'a\r\nb\r\n', [0]), /Select current changes/);
});

test('マージ・cherry-pick の途中では、index にも履歴にも触れずに止める', (t) => {
  const { root, git, write } = fixture(t);
  git('switch', '-c', 'feature');
  write('feature.txt', 'feature\n');
  git('add', '.');
  git('commit', '-m', 'feature');
  git('switch', 'main');
  write('b.ts', 'main\n');
  git('commit', '-am', 'main');
  git('merge', '--no-commit', '--no-ff', 'feature');
  write('a.ts', after);
  const head = git('rev-parse', 'HEAD');
  const state = git('status', '--porcelain');
  const selection = [{ path: 'a.ts', before, after, changes: [0] }];
  assert.throws(() => commitSelection(root, ['a.ts'], 'during merge', selection), /in progress/);
  assert.throws(() => commitFiles(root, ['a.ts'], 'during merge'), /in progress/);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), state);
  assert.ok(fs.existsSync(path.join(root, '.git/MERGE_HEAD')));
  assert.equal(fs.existsSync(path.join(root, '.git/index.lock')), false);
});

test('他の Git 操作の index.lock は消さず、場所を知らせずに失敗する', (t) => {
  const { root, git, write } = fixture(t);
  write('a.ts', after);
  fs.writeFileSync(path.join(root, '.git/index.lock'), '');
  assert.throws(
    () =>
      commitSelection(root, ['a.ts'], 'locked', [{ path: 'a.ts', before, after, changes: [0] }]),
    (error: Error) => /holds the index/.test(error.message) && !error.message.includes(root),
  );
  assert.ok(fs.existsSync(path.join(root, '.git/index.lock')));
  assert.equal(git('show', 'HEAD:a.ts'), before);
});

test('パスをパターンとして解釈せず、属性に従った内容で格納する', (t) => {
  const { root, git, write } = fixture(t);
  // `[A].ts` がパターンとして A.ts に一致すると、別ファイルのモード (実行可能) が使われる。
  write('A.ts', 'executable\n');
  fs.chmodSync(path.join(root, 'A.ts'), 0o755);
  write('[A].ts', before);
  write('crlf.txt', 'one\nkeep\ntwo\n');
  write('.gitattributes', '*.txt text eol=crlf\n');
  git('add', '.');
  git('commit', '-m', 'add files');
  write('[A].ts', after);
  write('crlf.txt', 'ONE\r\nkeep\r\nTWO\r\n');
  const crlfBefore = 'one\nkeep\ntwo\n';
  const crlfAfter = 'ONE\r\nkeep\r\nTWO\r\n';
  commitSelection(root, ['[A].ts', 'crlf.txt'], 'literal', [
    { path: '[A].ts', before, after, changes: [0] },
    { path: 'crlf.txt', before: crlfBefore, after: crlfAfter, changes: [0] },
  ]);
  assert.match(git('ls-tree', 'HEAD', '[A].ts'), /^100644 /);
  assert.equal(git('show', 'HEAD:[A].ts'), before.replace('first', 'FIRST'));
  // eol=crlf の作業ツリーは、git add と同じく LF に正規化して格納する。選んだ 1 行だけが変わる。
  assert.equal(git('show', 'HEAD:crlf.txt'), 'ONE\nkeep\ntwo\n');
  assert.equal(
    git('diff', '--numstat', 'HEAD~1', 'HEAD', '--', 'crlf.txt').trim(),
    '1\t1\tcrlf.txt',
  );
});

test('コピーとして検出された変更をコミットしても、コピー元を index から消さない', (t) => {
  const { root, git, write } = fixture(t);
  git('config', 'status.renames', 'copies');
  write('copy.ts', before);
  write('a.ts', after);
  git('add', '.');
  const entries = gitStatus(root).entries;
  const copy = entries.find((entry) => entry.path === 'copy.ts');
  assert.equal(copy?.index, 'C');
  assert.equal(copy?.oldPath, 'a.ts');
  commitSelection(root, ['copy.ts'], 'copy only', []);
  assert.deepEqual(git('ls-tree', '--name-only', 'HEAD').trim().split('\n'), [
    'a.ts',
    'b.ts',
    'copy.ts',
  ]);
  assert.equal(git('show', ':a.ts'), after);
  assert.equal(git('show', 'HEAD:a.ts'), before);
});

test('構造解析はコメントを無視し、ネストした宣言の範囲を返す', () => {
  const text =
    '// function fake() {}\nclass Example { method() { const nested = () => 1; } }\nconst run = () => 2;';
  const symbols = outline('example.ts', text);
  assert.deepEqual(
    symbols.map((s) => s.name),
    ['Example', 'method', 'nested', 'run'],
  );
  assert.deepEqual(
    symbols.map((s) => s.depth),
    [0, 1, 2, 0],
  );
  for (const symbol of symbols)
    assert.ok(text.slice(symbol.start, symbol.end).includes(symbol.name));
  assert.deepEqual(outline('example.md', text), []);
});
