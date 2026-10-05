import type { Appearance } from '../../../shared/appearance.ts';
import { rendererTheme } from '../../styles/renderer-theme';

type FontDefaults = { ui: number; editor: number; terminal: number; lineHeight: number };
let defaults: FontDefaults | undefined;
/** デザイントークンの既定値。設定で上書きする前に一度だけ読む。 */
export function defaultFontSizes(): FontDefaults {
  if (!defaults) {
    const theme = rendererTheme();
    defaults = {
      ui: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--ui-font-size'),
      ),
      editor: theme.editorFontSize,
      terminal: theme.terminalFontSize,
      lineHeight: theme.editorLineHeight,
    };
  }
  return defaults;
}
export function applyFontSizeTokens(value: Appearance): void {
  const base = defaultFontSizes();
  const style = document.documentElement.style;
  style.setProperty('--ui-font-size', `${value.ui ?? base.ui}px`);
  style.setProperty('--editor-font-size', `${value.editor ?? base.editor}px`);
  style.setProperty('--terminal-font-size', `${value.terminal ?? base.terminal}px`);
  // 文字の大きさを変えても、テーマの行の高さの比率を保つ。
  style.setProperty(
    '--editor-line-height',
    `${Math.round(((value.editor ?? base.editor) * base.lineHeight) / base.editor)}px`,
  );
}
