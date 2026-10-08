import assert from 'node:assert/strict';
import test from 'node:test';
import { computeChanges, mapOffset, revertEdit } from '../src/features/git/diff-model.ts';

test('差分を後ろから取り消すと、空行・末尾改行を含めて比較元を復元する', async () => {
  const texts = ['', 'a', 'a\n', '\na\n', 'a\nb\nc', 'a\nx\ny\nc\n', '日本語\n😀\n'];
  for (const eol of ['\n', '\r\n']) {
    for (const a of texts) {
      for (const b of texts) {
        const before = a.split('\n');
        let current = b.replaceAll('\n', eol);
        const changes = await computeChanges(before, b.split('\n'));
        for (const change of changes.reverse()) {
          const edit = revertEdit(before, current.split(eol), change, eol);
          current = current.slice(0, edit.from) + edit.text + current.slice(edit.to);
        }
        assert.equal(current, a.replaceAll('\n', eol));
      }
    }
  }
});

test('一つの差分だけを取り消し、離れた変更は残す', async () => {
  const before = ['old', 'context', 'context2', 'context3', 'end'];
  const after = ['new', 'context', 'context2', 'context3', 'added', 'end'];
  const changes = await computeChanges(before, after);
  assert.equal(changes.length, 2);
  const edit = revertEdit(before, after, changes[0], '\n');
  const text = after.join('\n');
  assert.equal(
    text.slice(0, edit.from) + edit.text + text.slice(edit.to),
    'old\ncontext\ncontext2\ncontext3\nadded\nend',
  );
});

test('スクロール対応は追加・削除を挟んでも逆行せず有限になる', () => {
  for (const anchors of [
    [
      [0, 0],
      [20, 20],
      [20, 80],
      [100, 160],
    ],
    [
      [0, 0],
      [20, 20],
      [80, 20],
      [160, 100],
    ],
  ] satisfies [number, number][][]) {
    let previous = -1;
    for (let y = 0; y < 200; y++) {
      const mapped = mapOffset(y, anchors);
      assert.ok(Number.isFinite(mapped));
      assert.ok(mapped >= previous);
      previous = mapped;
    }
  }
});

test('対応区間内は等速で進み、短い側の端で待ってから次の対応区間へ移る', () => {
  const anchors: [number, number][] = [
    [0, 0],
    [100, 100],
    [300, 140],
    [500, 340],
  ];
  assert.equal(mapOffset(120, anchors), 120);
  assert.equal(mapOffset(160, anchors), 140);
  assert.equal(mapOffset(260, anchors), 140);
  assert.equal(mapOffset(320, anchors), 160);
  const reverse = anchors.map(([a, b]): [number, number] => [b, a]);
  assert.equal(mapOffset(120, reverse), 120);
  assert.equal(mapOffset(140, reverse), 300);
  assert.equal(mapOffset(160, reverse), 320);
});
