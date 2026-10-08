import { type ArrayChange, diffArrays, diffChars } from 'diff';
import type { editor } from 'monaco-editor';

/** Monaco と同じ行範囲表現。空の側は直前の行番号を start に持ち、end が 0。 */
export function lineChanges(parts: ArrayChange<string>[]): editor.ILineChange[] {
  const result: editor.ILineChange[] = [];
  // 画面が応答しなくならないよう、文字単位の強調の計算は全体で 40ms までにする。
  // 時間を超えた変更は行単位の強調だけを表示する。
  const characterDeadline = performance.now() + 40;
  let oldLine = 0;
  let newLine = 0;
  for (let i = 0; i < parts.length; ) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      oldLine += part.value.length;
      newLine += part.value.length;
      i++;
      continue;
    }
    const oldStart = oldLine;
    const newStart = newLine;
    const before: string[] = [];
    const after: string[] = [];
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      const next = parts[i++];
      if (next.removed) {
        before.push(...next.value);
        oldLine += next.value.length;
      } else {
        after.push(...next.value);
        newLine += next.value.length;
      }
    }
    const charChanges: editor.ICharChange[] = [];
    const change: editor.ILineChange = {
      charChanges,
      originalStartLineNumber: oldLine === oldStart ? oldStart : oldStart + 1,
      originalEndLineNumber: oldLine === oldStart ? 0 : oldLine,
      modifiedStartLineNumber: newLine === newStart ? newStart : newStart + 1,
      modifiedEndLineNumber: newLine === newStart ? 0 : newLine,
    };
    if (before.length && after.length && performance.now() < characterDeadline) {
      const characterParts = diffChars(before.join('\n'), after.join('\n'), {
        timeout: Math.max(1, characterDeadline - performance.now()),
      });
      let originalPosition = { line: oldStart + 1, column: 1 };
      let modifiedPosition = { line: newStart + 1, column: 1 };
      const advance = (
        position: typeof originalPosition,
        text: string,
      ): typeof originalPosition => {
        const lines = text.split('\n');
        return lines.length === 1
          ? { line: position.line, column: position.column + text.length }
          : { line: position.line + lines.length - 1, column: lines[lines.length - 1].length + 1 };
      };
      for (const part of characterParts ?? []) {
        const originalEnd = part.added ? originalPosition : advance(originalPosition, part.value);
        const modifiedEnd = part.removed ? modifiedPosition : advance(modifiedPosition, part.value);
        if (part.added || part.removed)
          charChanges.push({
            originalStartLineNumber: originalPosition.line,
            originalStartColumn: originalPosition.column,
            originalEndLineNumber: originalEnd.line,
            originalEndColumn: originalEnd.column,
            modifiedStartLineNumber: modifiedPosition.line,
            modifiedStartColumn: modifiedPosition.column,
            modifiedEndLineNumber: modifiedEnd.line,
            modifiedEndColumn: modifiedEnd.column,
          });
        originalPosition = originalEnd;
        modifiedPosition = modifiedEnd;
      }
    }
    result.push(change);
  }
  return result;
}

export function computeChanges(before: string[], after: string[]): Promise<editor.ILineChange[]> {
  return new Promise((resolve, reject) => {
    diffArrays(before, after, {
      // 大きな差分で画面を待たせ続けないための上限。超えた場合は小さいファイルで比べるよう案内する。
      timeout: 3000,
      callback: (parts) => {
        if (parts) resolve(lineChanges(parts));
        else
          reject(new Error('Diff calculation timed out. Open a smaller file to compare changes.'));
      },
    });
  });
}

/**
 * 行の追加・削除でも末尾改行を保持し、変更範囲以外を再編集しない最小の編集へ変換する。
 * @param before 比較元の側の行
 * @param after 変更後の側 (編集するモデル) の行
 * @param change 取り消す行差分
 * @param eol 編集するモデルの改行コード
 */
export function revertEdit(
  before: string[],
  after: string[],
  change: editor.ILineChange,
  eol: string,
): { from: number; to: number; text: string } {
  const start = change.modifiedEndLineNumber
    ? change.modifiedStartLineNumber - 1
    : change.modifiedStartLineNumber;
  const count = change.modifiedEndLineNumber ? change.modifiedEndLineNumber - start : 0;
  const replacement = change.originalEndLineNumber
    ? before.slice(change.originalStartLineNumber - 1, change.originalEndLineNumber)
    : [];
  const lines = after.slice();
  lines.splice(start, count, ...replacement);
  const current = after.join(eol);
  const next = lines.join(eol);
  let from = 0;
  while (from < current.length && from < next.length && current[from] === next[from]) from++;
  let end = current.length;
  let nextEnd = next.length;
  while (end > from && nextEnd > from && current[end - 1] === next[nextEnd - 1]) {
    end--;
    nextEnd--;
  }
  return { from, to: end, text: next.slice(from, nextEnd) };
}

/**
 * スクロール元の位置を、対応点の間は等速で進め、短い側の端で待つように相手側の位置へ写す。
 * @param offset スクロール元の位置
 * @param anchors [スクロール元の位置, 相手側の位置] の組。上から順に並べる
 */
export function mapOffset(offset: number, anchors: [number, number][]): number {
  if (offset <= 0) return 0;
  for (let i = 1; i < anchors.length; i++) {
    const [source, target] = anchors[i];
    const [previousSource, previousTarget] = anchors[i - 1];
    if (offset === source) return target;
    if (offset < source && source > previousSource)
      return Math.min(previousTarget + offset - previousSource, target);
  }
  const [source, target] = anchors.at(-1) ?? [0, 0];
  return target + offset - source;
}
