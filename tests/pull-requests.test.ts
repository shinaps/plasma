import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listPullRequests, openPullRequest, pullRequestDiff } from '../server/pull-requests.ts';

test('PR比較は分岐点の全変更を取得し、作業ツリー・index・ブランチを保持する', async (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-pr-test-'));
  const remote = path.join(fixture, 'remote');
  const root = path.join(fixture, 'local');
  const bin = path.join(fixture, 'bin');
  fs.mkdirSync(remote);
  fs.mkdirSync(bin);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const write = (name: string, text: string) => fs.writeFileSync(path.join(remote, name), text);
  git(remote, 'init', '-b', 'main');
  git(remote, 'config', 'user.name', 'Fixture');
  git(remote, 'config', 'user.email', 'fixture@example.invalid');
  write('old.txt', 'same\n');
  write('deleted.txt', 'gone\n');
  write('changed.txt', 'before\n');
  git(remote, 'add', '.');
  git(remote, 'commit', '-m', 'base');
  const base = git(remote, 'rev-parse', 'HEAD');
  git(remote, 'checkout', '-b', 'feature');
  git(remote, 'mv', 'old.txt', 'new.txt');
  git(remote, 'rm', 'deleted.txt');
  write('changed.txt', 'after\n');
  write('added.txt', 'new\n');
  git(remote, 'add', '.');
  git(remote, 'commit', '-m', 'feature');
  const head = git(remote, 'rev-parse', 'HEAD');
  git(remote, 'checkout', 'main');
  write('base-only.txt', 'base advanced\n');
  git(remote, 'add', '.');
  git(remote, 'commit', '-m', 'base advanced');
  const tip = git(remote, 'rev-parse', 'HEAD');
  execFileSync('git', ['clone', '--quiet', '--single-branch', remote, root]);
  fs.writeFileSync(path.join(root, 'changed.txt'), 'staged');
  git(root, 'add', '.');
  fs.writeFileSync(path.join(root, 'changed.txt'), 'unsaved on disk');
  const pr = {
    number: 7,
    title: 'Fixture PR',
    html_url: 'https://github.com/example/repo/pull/7',
    draft: false,
    base: { ref: 'main', sha: tip },
    head: { ref: 'feature', sha: head },
  };
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env node\nconst args=process.argv.slice(2);console.log(JSON.stringify(args[0]==='repo'?${JSON.stringify({ nameWithOwner: 'example/repo', url: remote })}:args.includes('--paginate')?[[${JSON.stringify(pr)}]]:${JSON.stringify(pr)}));\n`,
    { mode: 0o755 },
  );
  // サーバーの PATH に gh が無くても (アプリから起動された MCP サーバー)、ログインシェルの PATH から見つける。
  const previous = { PATH: process.env.PATH, SHELL: process.env.SHELL };
  fs.writeFileSync(
    path.join(bin, 'login-shell'),
    `#!/bin/sh\necho "profile noise"\ncase "$2" in *"command -v"*) echo "${path.join(bin, 'gh')}";; esac\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${path.dirname(process.execPath)}:/usr/bin:/bin`;
  process.env.SHELL = path.join(bin, 'login-shell');
  t.after(() => {
    process.env.PATH = previous.PATH;
    process.env.SHELL = previous.SHELL;
    fs.rmSync(fixture, { recursive: true, force: true });
  });
  const before = [
    git(root, 'status', '--porcelain'),
    git(root, 'rev-parse', 'HEAD'),
    git(root, 'write-tree'),
    git(root, 'symbolic-ref', 'HEAD'),
  ];
  assert.equal((await listPullRequests(root)).requests[0].number, 7);
  const comparison = await openPullRequest(root, 7);
  assert.equal(comparison.baseCommit, base);
  assert.equal(comparison.headCommit, head);
  assert.deepEqual(comparison.entries.map((entry) => entry.path).sort(), [
    'added.txt',
    'changed.txt',
    'deleted.txt',
    'new.txt',
  ]);
  assert.equal(pullRequestDiff(root, comparison.id, 'changed.txt').modified, 'after\n');
  const moved = pullRequestDiff(root, comparison.id, 'new.txt');
  assert.equal(moved.originalPath, 'old.txt');
  assert.equal(moved.original, moved.modified);
  assert.equal(moved.editable, false);
  assert.equal(moved.inWorkingTree, false);
  assert.equal(pullRequestDiff(root, comparison.id, 'added.txt').originalExists, false);
  assert.equal(pullRequestDiff(root, comparison.id, 'deleted.txt').modified, '');
  assert.throws(() => pullRequestDiff(root, comparison.id, 'base-only.txt'));
  assert.deepEqual(
    [
      git(root, 'status', '--porcelain'),
      git(root, 'rev-parse', 'HEAD'),
      git(root, 'write-tree'),
      git(root, 'symbolic-ref', 'HEAD'),
    ],
    before,
  );
  assert.equal(fs.existsSync(path.join(root, '.git', 'FETCH_HEAD')), false);
  const next = await openPullRequest(root, 7);
  assert.notEqual(next.id, comparison.id);
  assert.throws(() => pullRequestDiff(root, comparison.id, 'new.txt'), /expired/);
});
