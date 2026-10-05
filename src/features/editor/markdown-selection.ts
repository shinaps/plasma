import type { Element, Root } from 'hast';

/** 描画した要素に元の行番号を付ける。描画後の文字列を探すより正確で速い。 */
export function markdownSourceLines(): (tree: Root) => void {
  return (tree: Root) => {
    const visit = (node: Root | Element) => {
      if (node.type === 'element' && node.position) {
        const { start, end } = node.position;
        node.properties['data-source-start'] = start.line;
        node.properties['data-source-end'] =
          end.column === 1 && end.line > start.line ? end.line - 1 : end.line;
      }
      for (const child of node.children) if (child.type === 'element') visit(child);
    };
    visit(tree);
  };
}

/** プレビュー内の選択範囲を元の行範囲に変換する。選択がなければ undefined。 */
export function selectedMarkdownLines(
  preview: HTMLElement,
): { startLine: number; endLine: number } | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!preview.contains(range.startContainer) || !preview.contains(range.endContainer)) return;
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
  let start = Infinity;
  let end = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim() || !range.intersectsNode(node)) continue;
    // Range の端は含まれない。境界に触れただけの次のブロックを範囲に入れない。
    if (node === range.endContainer && range.endOffset === 0) continue;
    if (node === range.startContainer && range.startOffset === node.textContent.length) continue;
    const source = node.parentElement?.closest<HTMLElement>('[data-source-start]');
    if (!source) continue;
    start = Math.min(start, Number(source.dataset.sourceStart));
    end = Math.max(end, Number(source.dataset.sourceEnd));
  }
  if (end) return { startLine: start, endLine: end };
}
