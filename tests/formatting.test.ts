import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Projects } from '../server/projects.ts';

/** 標準入力を受け取って整形結果を書く、整形器の代わりのスクリプトを node_modules に置く。 */
function installFormatter(root: string, name: string, bin: string, script: string): void {
  const local = path.join(root, 'node_modules', name);
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(
    path.join(local, 'package.json'),
    JSON.stringify({ name, version: 'fixture', bin: { [bin]: 'cli.cjs' } }),
  );
  fs.writeFileSync(path.join(local, 'cli.cjs'), script);
}

test('save settings persist per project; formatting uses local tool and retains edits on failure or conflict', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-format-'));
  const directory = path.join(temp, 'state');
  const projects = new Projects({ directory });
  try {
    const roots: string[] = [];
    for (const name of ['one', 'two']) {
      const folder = path.join(temp, name);
      fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, 'code.ts'), 'before');
      roots.push((await projects.dispatch({ op: 'project-open', path: folder })).root);
    }
    const [root, other] = roots;
    const codeFile = path.join(root, 'code.ts');
    const cli = path.join(root, 'node_modules/@biomejs/biome/cli.cjs');
    installFormatter(
      root,
      '@biomejs/biome',
      'biome',
      `let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{if(process.cwd()!==${JSON.stringify(root)})process.exit(2);if(!process.argv.includes('--stdin-file-path='+${JSON.stringify(codeFile)}))process.exit(3);process.stdout.write(s.toUpperCase())});`,
    );
    await projects.dispatch({ op: 'settings-set', root, formatOnSave: true });
    const reopened = new Projects({ directory });
    await reopened.dispatch({ op: 'project-open', path: root });
    assert.equal((await reopened.dispatch({ op: 'settings-get', root })).formatOnSave, true);
    reopened.dispose();
    assert.equal(
      (await projects.dispatch({ op: 'settings-get', root: other })).formatOnSave,
      false,
    );
    const document = await projects.dispatch({ op: 'read', root, path: 'code.ts' });
    let saved = await projects.dispatch({
      op: 'save',
      root,
      path: 'code.ts',
      text: 'after',
      revision: document.revision,
    });
    assert.equal(saved.text, 'AFTER');
    assert.equal(fs.readFileSync(codeFile, 'utf8'), 'AFTER');
    fs.writeFileSync(cli, "process.stderr.write('bad configuration');process.exit(1)");
    saved = await projects.dispatch({
      op: 'save',
      root,
      path: 'code.ts',
      text: 'keep my text',
      revision: saved.revision,
    });
    assert.equal(saved.text, 'keep my text');
    assert.match(saved.warning ?? '', /bad configuration/);
    fs.writeFileSync(
      cli,
      `require('node:fs').writeFileSync(${JSON.stringify(codeFile)},'external');process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('formatted'));`,
    );
    await assert.rejects(
      projects.dispatch({
        op: 'save',
        root,
        path: 'code.ts',
        text: 'new edit',
        revision: saved.revision,
      }),
      /changed on disk/,
    );
    assert.equal(fs.readFileSync(codeFile, 'utf8'), 'external');
  } finally {
    projects.dispose();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('a formatter that exits without output keeps the text and warns; a string bin manifest is detected', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-format-empty-'));
  const projects = new Projects({ directory: path.join(temp, 'state') });
  try {
    fs.writeFileSync(path.join(temp, 'code.ts'), 'keep');
    const root = (await projects.dispatch({ op: 'project-open', path: temp })).root;
    // bin が文字列の package.json。標準入力を読まずに正常終了するので出力が空になる。
    const local = path.join(root, 'node_modules/oxfmt');
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(
      path.join(local, 'package.json'),
      JSON.stringify({ name: 'oxfmt', version: 'fixture', bin: 'cli.cjs' }),
    );
    fs.writeFileSync(path.join(local, 'cli.cjs'), 'process.exit(0)');
    await projects.dispatch({ op: 'settings-set', root, formatOnSave: true, formatter: 'oxfmt' });
    assert.equal((await projects.dispatch({ op: 'settings-get', root })).active?.id, 'oxfmt');
    const document = await projects.dispatch({ op: 'read', root, path: 'code.ts' });
    const saved = await projects.dispatch({
      op: 'save',
      root,
      path: 'code.ts',
      text: 'keep edited',
      revision: document.revision,
    });
    assert.equal(saved.text, 'keep edited');
    assert.match(saved.warning ?? '', /produced no output/);
    assert.equal(fs.readFileSync(path.join(root, 'code.ts'), 'utf8'), 'keep edited');
  } finally {
    projects.dispose();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('a formatter result over the text limit is treated as not formatted', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-format-huge-'));
  const projects = new Projects({ directory: path.join(temp, 'state') });
  try {
    fs.writeFileSync(path.join(temp, 'code.ts'), 'before');
    const root = (await projects.dispatch({ op: 'project-open', path: temp })).root;
    installFormatter(
      root,
      'oxfmt',
      'oxfmt',
      `process.stdout.write('x'.repeat(2 * 1024 * 1024 + 1))`,
    );
    await projects.dispatch({ op: 'settings-set', root, formatOnSave: true, formatter: 'oxfmt' });
    const document = await projects.dispatch({ op: 'read', root, path: 'code.ts' });
    const saved = await projects.dispatch({
      op: 'save',
      root,
      path: 'code.ts',
      text: 'after',
      revision: document.revision,
    });
    assert.equal(saved.text, 'after');
    assert.match(saved.warning ?? '', /could not be applied/);
  } finally {
    projects.dispose();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('format on save leaves files outside the formatter scope untouched without warnings', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-format-scope-'));
  const projects = new Projects({ directory: path.join(temp, 'state') });
  try {
    fs.writeFileSync(path.join(temp, 'notes.md'), '# notes');
    const root = (await projects.dispatch({ op: 'project-open', path: temp })).root;
    installFormatter(root, '@biomejs/biome', 'biome', 'process.exit(1)');
    await projects.dispatch({ op: 'settings-set', root, formatOnSave: true });
    const document = await projects.dispatch({ op: 'read', root, path: 'notes.md' });
    const saved = await projects.dispatch({
      op: 'save',
      root,
      path: 'notes.md',
      text: '# notes\n\nmore',
      revision: document.revision,
    });
    assert.equal(saved.text, '# notes\n\nmore');
    assert.equal(saved.warning, undefined);
  } finally {
    projects.dispose();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('formatter selection persists, chooses Vite+ automatically, and never falls back from a missing explicit selection', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-providers-'));
  const directory = path.join(temp, 'state');
  const projects = new Projects({ directory });
  try {
    fs.writeFileSync(path.join(temp, 'code.ts'), 'original');
    const root = (await projects.dispatch({ op: 'project-open', path: temp })).root;
    const codeFile = path.join(root, 'code.ts');
    for (const [name, bin] of [
      ['oxfmt', 'oxfmt'],
      ['vite-plus', 'vp'],
    ] as const) {
      const expected =
        name === 'vite-plus'
          ? ['fmt', `--stdin-filepath=${codeFile}`]
          : [`--stdin-filepath=${codeFile}`];
      installFormatter(
        root,
        name,
        bin,
        `const expected=${JSON.stringify(expected)};require('node:assert/strict').deepEqual(process.argv.slice(2),expected);process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(name)}));`,
      );
    }
    assert.equal((await projects.dispatch({ op: 'settings-get', root })).active?.id, 'vite-plus');
    await projects.dispatch({ op: 'settings-set', root, formatOnSave: true, formatter: 'oxfmt' });
    const reopened = new Projects({ directory });
    await reopened.dispatch({ op: 'project-open', path: root });
    assert.equal((await reopened.dispatch({ op: 'settings-get', root })).formatter, 'oxfmt');
    reopened.dispose();
    let document = await projects.dispatch({ op: 'read', root, path: 'code.ts' });
    for (const formatter of ['oxfmt', 'vite-plus'] as const) {
      await projects.dispatch({ op: 'settings-set', root, formatOnSave: true, formatter });
      document = await projects.dispatch({
        op: 'save',
        root,
        path: 'code.ts',
        text: 'draft',
        revision: document.revision,
      });
      assert.equal(document.text, formatter);
    }
    await projects.dispatch({ op: 'settings-set', root, formatOnSave: true, formatter: 'biome' });
    document = await projects.dispatch({
      op: 'save',
      root,
      path: 'code.ts',
      text: 'unchanged',
      revision: document.revision,
    });
    assert.equal(document.text, 'unchanged');
    assert.match(document.warning ?? '', /No formatter found/);
    await assert.rejects(
      projects.dispatch({
        op: 'settings-set',
        root,
        formatOnSave: true,
        formatter: 'arbitrary-command',
      }),
    );
  } finally {
    projects.dispose();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
