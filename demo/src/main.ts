import { calculateTotal, formatYen } from './pricing.ts';
import type { Item } from './pricing.ts';

// calculateTotal にカーソルを置き、「定義へ」で別ファイルへ移動。
// 「参照」で、この関数を使う場所を一覧できます。
const items: Item[] = [
  { name: 'Notebook', price: 800, quantity: 2 },
  { name: 'Pen', price: 200, quantity: 3 },
];

const total = calculateTotal(items);
console.log(formatYen(total));

// number を string に変えると、型エラーを確認できます。
const preview: number = total;
console.log(preview);
