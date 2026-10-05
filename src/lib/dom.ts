/** 要素が無ければ、後で null を触って落ちる代わりに、ここでセレクタ付きのエラーにする。 */
export function requireElement<T extends HTMLElement = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
}
