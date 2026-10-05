export interface Item {
  name: string;
  price: number;
  quantity: number;
}

/** 商品の小計に税率を適用し、円単位で丸めます。 */
export function calculateTotal(items: Item[], taxRate = 0.1): number {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return Math.round(subtotal * (1 + taxRate));
}

export function formatYen(amount: number): string {
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount);
}
