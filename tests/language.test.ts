import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageType } from '../shared/image-types.ts';
import { isSource, languageFor } from '../shared/language.ts';

test('extension tables only answer for listed extensions, never for object prototype names', () => {
  assert.equal(languageFor('a.ts'), 'typescript');
  assert.equal(isSource('a.tsx'), true);
  assert.equal(isSource('a.css'), false);
  assert.equal(imageType('a.PNG'), 'image/png');
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.equal(languageFor(`a.${name}`), 'plaintext');
    assert.equal(imageType(`a.${name}`), undefined);
  }
});
