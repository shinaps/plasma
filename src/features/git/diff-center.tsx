import * as monaco from 'monaco-editor/editor/editor.api';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { renderReact, unmountReact } from '../../lib/react-view';
import { lineBounds, type NaturalDiff } from './natural-diff';

const svgNamespace = 'http://www.w3.org/2000/svg';
// 左の行番号 (幅の 40%) と右のチェックボックス (右端 24px) の間に曲線を引く。
// 曲線は 45% から 72% の間で左右をつなぎ、行番号と重ねない。
const originalLineNumberRatio = 0.4;
const curveStartRatio = 0.45;
const curveEndRatio = 0.72;
const modifiedLineNumberInset = 24;
// 共通Checkboxのsize-3.5と同じ大きさ。行の高さの中央に置く。
const checkboxSize = 14;

/** 中央は独立した列。左右の自然な行位置をつなぎ、コード領域へ重ねない。 */
export function attachDiffCenter(diff: NaturalDiff, host: HTMLElement): void {
  const original = diff.getOriginalEditor();
  const modified = diff.getModifiedEditor();
  const root = document.createElementNS(svgNamespace, 'svg');
  root.classList.add('diff-center');
  root.setAttribute('aria-hidden', 'true');
  const controls = document.createElement('div');
  controls.className = 'diff-center-controls';
  host.append(root, controls);
  let frame = 0;
  let disposed = false;
  const draw = (): void => {
    frame = 0;
    const width = host.clientWidth;
    const height = host.clientHeight;
    const font = modified.getOption(monaco.editor.EditorOption.fontInfo);
    const lineHeight = modified.getOption(monaco.editor.EditorOption.lineHeight);
    root.setAttribute('width', String(width));
    root.setAttribute('height', String(height));
    root.style.fontFamily = font.fontFamily;
    root.style.fontSize = `${font.fontSize}px`;
    const elements: SVGElement[] = [];
    const controlElements: ReactNode[] = [];
    for (const change of diff.getLineChanges()) {
      const before = lineBounds(original, change, 'original');
      const after = lineBounds(modified, change, 'modified');
      const [originalTop, originalBottom] = before.map((y) => y - original.getScrollTop());
      const [modifiedTop, modifiedBottom] = after.map((y) => y - modified.getScrollTop());
      if (
        Math.max(originalBottom, modifiedBottom) < 0 ||
        Math.min(originalTop, modifiedTop) > height
      )
        continue;
      const kind = !change.originalEndLineNumber
        ? 'added'
        : !change.modifiedEndLineNumber
          ? 'removed'
          : 'changed';
      const left = width * curveStartRatio;
      const right = width * curveEndRatio;
      const mid = (left + right) / 2;
      const top = `M0 ${originalTop} H${left} C${mid} ${originalTop} ${mid} ${modifiedTop} ${right} ${modifiedTop} H${width}`;
      const fill = document.createElementNS(svgNamespace, 'path');
      fill.setAttribute(
        'd',
        `${top} V${modifiedBottom} H${right} C${mid} ${modifiedBottom} ${mid} ${originalBottom} ${left} ${originalBottom} H0 Z`,
      );
      fill.style.fill = `var(--color-diff-${kind}-line)`;
      elements.push(fill);
      // 空の側は面積がないため塗りだけでは線が消える。コード側の1pxアンカーを曲線へつなぐ。
      if (kind !== 'changed') {
        const edge = document.createElementNS(svgNamespace, 'path');
        edge.setAttribute(
          'd',
          `${top} M0 ${originalBottom} H${left} C${mid} ${originalBottom} ${mid} ${modifiedBottom} ${right} ${modifiedBottom} H${width}`,
        );
        edge.setAttribute('fill', 'none');
        edge.style.stroke = `var(--color-diff-${kind}-text)`;
        edge.setAttribute('stroke-width', '1');
        elements.push(edge);
      }
      if (diff.canRevert() && originalTop >= 0 && originalTop < height) {
        controlElements.push(
          <Button
            key={`revert:${change.originalStartLineNumber}:${change.modifiedStartLineNumber}`}
            variant="plain"
            size="content"
            className="diff-revert"
            style={{ top: originalTop, height: lineHeight }}
            title="Revert Change"
            aria-label={`Revert change at line ${Math.max(1, change.modifiedStartLineNumber)}`}
            onClick={() => diff.revert(change)}
          >
            »
          </Button>,
        );
      }
    }
    if (diff.selection && diff.canRevert()) {
      for (const [index, change] of diff.getLineChanges().entries()) {
        const [top] = lineBounds(modified, change, 'modified');
        const y = top - modified.getScrollTop();
        if (y < 0 || y >= height) continue;
        controlElements.push(
          <Checkbox
            key={`include:${change.originalStartLineNumber}:${change.modifiedStartLineNumber}`}
            className="absolute right-[3px] m-0 pointer-events-auto cursor-pointer"
            style={{ top: y + (lineHeight - checkboxSize) / 2 }}
            checked={diff.selection.checked(index)}
            aria-label={`Include change ${index + 1} in commit`}
            onCheckedChange={(value) => diff.selection?.toggle(index, value === true)}
          />,
        );
      }
    }
    for (const [editor, x] of [
      [original, width * originalLineNumberRatio],
      [modified, width - modifiedLineNumberInset],
    ] as const) {
      for (const visible of editor.getVisibleRanges()) {
        for (let line = visible.startLineNumber; line <= visible.endLineNumber; line++) {
          const text = document.createElementNS(svgNamespace, 'text');
          text.setAttribute('x', String(x));
          text.setAttribute(
            'y',
            String(editor.getTopForLineNumber(line) - editor.getScrollTop() + lineHeight / 2),
          );
          text.setAttribute('text-anchor', 'end');
          text.setAttribute('dominant-baseline', 'central');
          text.textContent = String(line);
          elements.push(text);
        }
      }
    }
    root.replaceChildren(...elements);
    renderReact(controls, controlElements);
  };
  const schedule = (): void => {
    if (!disposed && !frame) frame = requestAnimationFrame(draw);
  };
  diff.onDidUpdateDiff(schedule);
  for (const editor of [original, modified]) {
    editor.onDidScrollChange(schedule);
    editor.onDidLayoutChange(schedule);
    editor.onDidContentSizeChange(schedule);
    editor.onDidChangeConfiguration(schedule);
  }
  modified.onDidDispose(() => {
    disposed = true;
    cancelAnimationFrame(frame);
    unmountReact(controls);
  });
  schedule();
}
