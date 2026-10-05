import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFileRoute } from '../shared/file-route.ts';

const route = (query: Record<string, string>): string => `/open?${new URLSearchParams(query)}`;

test('file routes preserve project, file and range through URL encoding', () => {
  const target = {
    project: '/Users/test/日本語 project',
    file: 'src/a #?&.tsx',
    line: 4,
    endLine: 9,
  };
  assert.deepEqual(
    parseFileRoute(
      route({ ...target, line: String(target.line), endLine: String(target.endLine) }),
    ),
    target,
  );
  assert.equal(parseFileRoute('/'), null);
});

test('navigation requires an absolute project, a file and a positive ordered line range', () => {
  const invalid: Record<string, string>[] = [
    { project: 'relative', file: 'a.ts' },
    { project: '/project', file: '' },
    { project: '/project', file: 'a.ts', line: '0' },
    { project: '/project', file: 'a.ts', line: '5', endLine: '2' },
    { project: '/project', file: 'a.ts', line: '1.2' },
  ];
  for (const query of invalid) assert.throws(() => parseFileRoute(route(query)));
  // プロトコル相対や絶対 URL を route として受け付けると、外部のサイトへ移動させられる。
  for (const other of ['//evil/open', 'https://example.com/open'])
    assert.throws(() => parseFileRoute(other));
});
