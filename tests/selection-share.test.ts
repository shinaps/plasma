import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { SelectionShare } from '../src/features/editor/selection-share.ts';

test('共有する参照は実際の選択を表し、カーソルの行移動では更新しない', async () => {
  const updates: { content: { text: string }[]; structuredContent: { selection: unknown } }[] = [];
  const sharing = new SelectionShare({
    extensions: () =>
      ({
        modelContext: { update: async (value: (typeof updates)[number]) => updates.push(value) },
      }) as unknown as OpenAIExtensions,
    report: (message) => assert.fail(message),
  });
  const target = { root: '/project', path: 'file.ts', startLine: 1, endLine: 1, selected: false };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
  sharing.update(target);
  await settle();
  assert.equal(updates.at(-1)?.content[0].text, '/project/file.ts');
  assert.deepEqual(updates.at(-1)?.structuredContent.selection, {
    root: '/project',
    path: 'file.ts',
  });
  sharing.update({ ...target, startLine: 6, endLine: 6 });
  await settle();
  assert.equal(updates.length, 1);
  sharing.update({ ...target, startLine: 6, endLine: 6, selected: true });
  await settle();
  assert.equal(updates.at(-1)?.content[0].text, '/project/file.ts:6');
  sharing.update({ ...target, startLine: 6, endLine: 12, selected: true }, true);
  await settle();
  assert.equal(updates.length, 2);
  sharing.update({ ...target, startLine: 6, endLine: 12, selected: true });
  await settle();
  assert.equal(updates.at(-1)?.content[0].text, '/project/file.ts:6–12');
  sharing.update(target);
  await settle();
  assert.deepEqual(updates.at(-1)?.structuredContent.selection, {
    root: '/project',
    path: 'file.ts',
  });
  const pullRequest = {
    number: 7,
    url: 'https://github.com/example/repo/pull/7',
    baseCommit: 'base',
    headCommit: 'head',
  };
  sharing.update({ ...target, pullRequest });
  await settle();
  assert.match(updates.at(-1)?.content[0].text ?? '', /PR #7, commit head/);
  assert.deepEqual(updates.at(-1)?.structuredContent.selection, {
    root: target.root,
    path: target.path,
    pullRequest,
  });
  sharing.update(undefined);
  await settle();
  assert.equal(updates.at(-1)?.structuredContent.selection, null);
});
