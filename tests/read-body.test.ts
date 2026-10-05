import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { readBody } from '../server/read-body.ts';

test('UTF-8 bodies decode to the same text wherever the chunks split', async () => {
  const text = 'あいうえお abc 漢字';
  const bytes = Buffer.from(text);
  for (let split = 0; split <= bytes.length; split++) {
    const stream = Readable.from([bytes.subarray(0, split), bytes.subarray(split)]);
    assert.equal(await readBody(stream, bytes.length), text);
  }
});

test('bodies over the byte limit are rejected', async () => {
  const limit = { bytes: 8 };
  const stream = Readable.from([Buffer.alloc(limit.bytes), Buffer.alloc(1)]);
  await assert.rejects(readBody(stream, limit.bytes), /too large/);
});
