import * as monaco from 'monaco-editor/editor/editor.api';
import type { NaturalDiff } from './natural-diff';

/** 左右の編集モデルに変更/追加/削除の三色を付ける。 */
export function decorateDiff(diff: NaturalDiff): monaco.IDisposable {
  const original = diff.getOriginalEditor().createDecorationsCollection();
  const modified = diff.getModifiedEditor().createDecorationsCollection();
  const update = (): void => {
    const before: monaco.editor.IModelDeltaDecoration[] = [];
    const after: monaco.editor.IModelDeltaDecoration[] = [];
    for (const change of diff.getLineChanges()) {
      const kind = !change.originalEndLineNumber
        ? 'added'
        : !change.modifiedEndLineNumber
          ? 'removed'
          : 'changed';
      for (const [side, decorations] of [
        ['original', before],
        ['modified', after],
      ] as const) {
        const start = change[`${side}StartLineNumber`];
        const end = change[`${side}EndLineNumber`];
        if (!end) {
          decorations.push({
            range: new monaco.Range(Math.max(1, start), 1, Math.max(1, start), 1),
            options: {
              isWholeLine: true,
              className: `diff-${kind}-anchor-${start ? 'after' : 'before'}`,
            },
          });
          continue;
        }
        decorations.push({
          range: new monaco.Range(start, 1, end, 1),
          options: {
            isWholeLine: true,
            className: `diff-${kind}-line`,
          },
        });
        for (const charChange of change.charChanges ?? []) {
          if (!charChange[`${side}EndLineNumber`]) continue;
          decorations.push({
            range: new monaco.Range(
              charChange[`${side}StartLineNumber`],
              charChange[`${side}StartColumn`],
              charChange[`${side}EndLineNumber`],
              charChange[`${side}EndColumn`],
            ),
            options: { className: `diff-${kind}-text` },
          });
        }
      }
    }
    original.set(before);
    modified.set(after);
  };
  const subscription = diff.onDidUpdateDiff(update);
  return {
    dispose() {
      subscription.dispose();
      original.clear();
      modified.clear();
    },
  };
}
