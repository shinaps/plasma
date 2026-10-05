import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateTotal } from './pricing.ts';

test('合計は数量と税率を反映する', () => {
  assert.equal(calculateTotal([{ name: 'Notebook', price: 800, quantity: 2 }]), 1760);
});

test('空の買い物かごの合計はゼロ', () => {
  assert.equal(calculateTotal([]), 0);
});
