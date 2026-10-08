import { createButton } from '../../components/ui/button';
import type { NaturalDiff } from './natural-diff';

/** ファイル全体の変更位置。本文スクロールと独立した縮尺で現在地を失わないようにする。 */
export function attachDiffOverview(diff: NaturalDiff, host: HTMLElement): void {
  const ruler = document.createElement('div');
  ruler.className = 'diff-overview';
  ruler.setAttribute('aria-label', 'Changes overview');
  host.append(ruler);
  const editor = diff.getModifiedEditor();
  const draw = () => {
    const height = editor.getContentHeight();
    ruler.replaceChildren(
      ...diff.getLineChanges().map((change, index) => {
        const line = Math.max(1, change.modifiedStartLineNumber);
        const kind = !change.originalEndLineNumber
          ? 'added'
          : !change.modifiedEndLineNumber
            ? 'removed'
            : 'changed';
        const button = createButton({
          className: `diff-marker diff-marker-${kind}`,
        });
        button.type = 'button';

        button.title = `Change ${index + 1} · line ${line}`;
        button.setAttribute('aria-label', button.title);
        button.style.top = `${(editor.getTopForLineNumber(line) / height) * 100}%`;
        button.style.height = `${Math.max(0.6, ((editor.getBottomForLineNumber(Math.max(line, change.modifiedEndLineNumber)) - editor.getTopForLineNumber(line)) / height) * 100)}%`;
        button.onclick = () => {
          editor.setPosition({ lineNumber: line, column: 1 });
          editor.revealLineInCenter(line);
          editor.focus();
        };
        return button;
      }),
    );
  };
  diff.onDidUpdateDiff(draw);
  editor.onDidContentSizeChange(draw);
}
