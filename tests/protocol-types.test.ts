import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProjectHandlers } from '../server/projects.ts';

// op ごとの応答の型は ProjectHandlers が結び付ける。別の op の応答を返す実装は tsc -b で止まる。
const correct: Pick<ProjectHandlers, 'git-branches'> = {
  'git-branches': () => ({ branches: [] }),
};
const wrong: Pick<ProjectHandlers, 'git-branches'> = {
  // @ts-expect-error git-branches の応答に sessions は無い (terminal-list の応答)。
  'git-branches': () => ({ sessions: [] }),
};

test('op と応答の対応は型で検査する', () => {
  assert.equal(typeof correct['git-branches'], 'function');
  assert.equal(typeof wrong['git-branches'], 'function');
});
