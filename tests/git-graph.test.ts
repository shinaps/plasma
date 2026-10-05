import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutCommits } from '../shared/git-graph.ts';

test('ancestry lanes remain continuous across rows and pagination', () => {
  const commits = [
    { id: 'merge', parents: ['main', 'branch'] },
    { id: 'branch', parents: ['base'] },
    { id: 'main', parents: ['base'] },
    { id: 'base', parents: [] },
  ];
  const { rows } = layoutCommits(commits);
  assert.deepEqual(
    rows.map((row) => row.lane),
    [0, 1, 0, 0],
  );
  for (let i = 0; i < rows.length - 1; i++) {
    const exits = [
      ...new Set(rows[i].edges.filter((edge) => edge.half === 'bottom').map((edge) => edge.to)),
    ].sort();
    const entrances = rows[i + 1].edges
      .filter((edge) => edge.half === 'top')
      .map((edge) => edge.from)
      .sort();
    assert.deepEqual(exits, entrances);
  }
  assert.deepEqual(layoutCommits(commits.slice(0, 2)).rows, rows.slice(0, 2));
  assert.equal(rows.at(-1)?.edges.filter((edge) => edge.half === 'bottom').length, 0);
});

test('linear history stays on its trunk and repeated parents do not duplicate edges', () => {
  const graph = layoutCommits([
    { id: 'a', parents: ['b', 'b'] },
    { id: 'b', parents: [] },
  ]);
  assert.equal(graph.lanes, 1);
  assert.equal(graph.rows[0].edges.length, 1);
  assert.deepEqual(layoutCommits([]), { rows: [], lanes: 1 });
});

test('joining an occupied lane preserves the existing branch through the merge row', () => {
  const { rows } = layoutCommits([
    { id: 'm1', parents: ['m2', 'branch'] },
    { id: 'm2', parents: ['base', 'branch'] },
    { id: 'branch', parents: ['base'] },
    { id: 'base', parents: [] },
  ]);
  assert.ok(
    rows[1].edges.some((edge) => edge.half === 'bottom' && edge.from === 1 && edge.to === 1),
  );
  assert.ok(
    rows[1].edges.some((edge) => edge.half === 'bottom' && edge.from === 0 && edge.to === 1),
  );
});
