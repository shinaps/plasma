import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Projects } from '../server/projects.ts';
import { appearanceSchema } from '../shared/appearance.ts';

test('appearance persists without a project, rejects invalid updates and resets to tokens', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-appearance-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const projects = new Projects({ directory });
  context.after(() => projects.dispose());
  assert.deepEqual(await projects.dispatch({ op: 'appearance-get' }), {});
  const appearance = { ui: 18, editor: 16, terminal: 14, wordWrap: true };
  await projects.dispatch({ op: 'appearance-set', appearance });
  const reopened = new Projects({ directory });
  context.after(() => reopened.dispose());
  assert.deepEqual(await reopened.dispatch({ op: 'appearance-get' }), appearance);
  for (const editor of [0, 33, 12.5, '16', null])
    await assert.rejects(projects.dispatch({ op: 'appearance-set', appearance: { editor } }));
  await assert.rejects(projects.dispatch({ op: 'appearance-set', appearance: { wordWrap: 'on' } }));
  assert.deepEqual(await projects.dispatch({ op: 'appearance-get' }), appearance);
  await projects.dispatch({ op: 'appearance-set', appearance: {} });
  assert.deepEqual(await reopened.dispatch({ op: 'appearance-get' }), {});
});

test('appearance files written by a newer version remain readable: unknown keys are dropped', () => {
  assert.deepEqual(appearanceSchema.parse({ ui: 12, future: true }), { ui: 12 });
});
