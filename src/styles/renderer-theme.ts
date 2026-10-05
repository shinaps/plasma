type RendererTheme = {
  diffColors: Record<string, string>;
  background: string;
  surface: string;
  foreground: string;
  border: string;
  accent: string;
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
    diffColors: Object.fromEntries(
      [
        ['diffEditor.insertedLineBackground', 'added-line'],
        ['diffEditor.removedLineBackground', 'removed-line'],
        ['diffEditor.insertedTextBackground', 'added-text'],
        ['diffEditor.removedTextBackground', 'removed-text'],
        ['diffEditorGutter.insertedLineBackground', 'added-gutter'],
        ['diffEditorGutter.removedLineBackground', 'removed-gutter'],
      ].map(([key, token]) => [key, value(`--color-diff-${token}`)]),
    ),
    background: value('--color-background'),
    surface: value('--color-surface'),
    foreground: value('--color-foreground'),
    border: value('--color-border'),
    accent: value('--color-accent'),
    ring: value('--color-ring'),
    fontFamily: value('--font-mono'),
    editorFontSize: Number.parseFloat(value('--editor-font-size')),
    editorLineHeight: Number.parseFloat(value('--editor-line-height')),
    terminalFontSize: Number.parseFloat(value('--terminal-font-size')),
  };
}
