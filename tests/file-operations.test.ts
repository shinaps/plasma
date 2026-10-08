import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEntry, deleteEntry, transferEntry } from '../server/file-operations.ts';

test('file and recursive directory operations preserve contents and never overwrite collisions', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createEntry(root, 'source', true);
  fs.chmodSync(path.join(root, 'source'), 0o700);
  createEntry(root, 'source/nested', true);
  createEntry(root, 'source/nested/file.txt', false);
  fs.writeFileSync(path.join(root, 'source/nested/file.txt'), 'keep this content');
  transferEntry(root, 'source', 'copied', false);
  assert.equal(fs.statSync(path.join(root, 'copied')).mode & 0o777, 0o700);
  transferEntry(root, 'copied', 'moved', true);
  assert.equal(fs.existsSync(path.join(root, 'copied')), false);
  for (const name of ['source', 'moved']) {
    assert.equal(
      fs.readFileSync(path.join(root, name, 'nested/file.txt'), 'utf8'),
      'keep this content',
    );
  }
  transferEntry(root, 'moved/nested/file.txt', 'moved/nested/renamed.txt', true);
  assert.equal(fs.existsSync(path.join(root, 'moved/nested/file.txt')), false);
  transferEntry(root, 'moved/nested/renamed.txt', 'copy.txt', false);
  for (const move of [true, false]) {
    assert.throws(() => transferEntry(root, 'source', 'moved', move));
    assert.throws(() => transferEntry(root, 'source/nested/file.txt', 'copy.txt', move));
    assert.throws(() => transferEntry(root, 'source', 'source/nested/child', move));
  }
  assert.throws(() => createEntry(root, 'copy.txt', false));
  assert.throws(() => createEntry(root, 'moved', true));
  assert.equal(fs.readFileSync(path.join(root, 'copy.txt'), 'utf8'), 'keep this content');
  assert.equal(
    fs.readFileSync(path.join(root, 'source/nested/file.txt'), 'utf8'),
    'keep this content',
  );
  deleteEntry(root, 'moved');
  deleteEntry(root, 'copy.txt');
  assert.deepEqual(fs.readdirSync(root), ['source']);
});

test('mutations stay inside the project and reject protected trees without changing them', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-boundary-'));
  const root = path.join(base, 'project');
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(path.join(base, 'outside.txt'), 'outside');
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git/config'), 'git data');
  fs.mkdirSync(path.join(root, 'linked'));
  fs.symlinkSync(path.join(base, 'outside.txt'), path.join(root, 'linked/link'));
  fs.mkdirSync(path.join(root, 'nested-repo'));
  fs.mkdirSync(path.join(root, 'nested-repo/.git'));
  for (const name of [
    '',
    '.',
    '..',
    '../outside.txt',
    path.join(base, 'outside.txt'),
    '.git/config',
    'linked/link',
    'linked',
    'nested-repo',
  ]) {
    assert.throws(() => deleteEntry(root, name));
    assert.throws(() => transferEntry(root, name, 'destination', true));
    assert.throws(() => transferEntry(root, name, 'destination', false));
    assert.equal(fs.existsSync(path.join(root, 'destination')), false);
  }
  for (const name of ['../new.txt', '.git/new.txt', 'linked/link/new.txt'])
    assert.throws(() => createEntry(root, name, false));
  assert.equal(fs.readFileSync(path.join(base, 'outside.txt'), 'utf8'), 'outside');
  assert.equal(fs.readFileSync(path.join(root, '.git/config'), 'utf8'), 'git data');
  assert.equal(fs.lstatSync(path.join(root, 'linked/link')).isSymbolicLink(), true);
});

test('failed transfers retain the source and remove only their own partial destination', (t) => {
  if (process.getuid?.() === 0) return t.skip('Root bypasses filesystem permissions');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-transfer-failure-'));
  fs.mkdirSync(path.join(root, 'source'));
  const file = path.join(root, 'source/private.txt');
  fs.writeFileSync(file, 'preserved');
  t.after(() => {
    fs.chmodSync(path.join(root, 'source'), 0o755);
    fs.chmodSync(file, 0o600);
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.chmodSync(file, 0o000);
  assert.throws(() => transferEntry(root, 'source', 'partial', false));
  assert.equal(fs.existsSync(path.join(root, 'partial')), false);
  fs.chmodSync(file, 0o600);
  fs.chmodSync(path.join(root, 'source'), 0o555);
  assert.throws(() => transferEntry(root, 'source/private.txt', 'moved.txt', true));
  assert.equal(fs.existsSync(path.join(root, 'moved.txt')), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'preserved');
});
