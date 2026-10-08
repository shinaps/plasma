type RendererTheme = {
  background: string;
  foreground: string;
  ring: string;
  fontFamily: string;
  editorFontSize: number;
  editorLineHeight: number;
  terminalFontSize: number;
};
/** Monaco と xterm は CSS 変数を解釈しないので、トークンの値を解決して渡す。 */
export function rendererTheme(): RendererTheme {
  const styles = getComputedStyle(document.documentElement);
  const value = (name: string): string => styles.getPropertyValue(name).trim();
  return {
    background: value('--color-background'),
    foreground: value('--color-foreground'),
    ring: value('--color-ring'),
    fontFamily: value('--font-mono'),
    editorFontSize: Number.parseFloat(value('--editor-font-size')),
    editorLineHeight: Number.parseFloat(value('--editor-line-height')),
    terminalFontSize: Number.parseFloat(value('--terminal-font-size')),
  };
}
