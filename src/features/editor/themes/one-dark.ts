import type { editor } from 'monaco-editor/editor/editor.api';
import { editorTokens } from './one-dark-editor';

// エディタ領域の配色。TextMate のトークン色は highlighting.ts が登録する。
export const oneDark: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    ...editorTokens,
    'editorIndentGuide.background1': '#3b4048',
    'editorIndentGuide.activeBackground1': '#c8c8c859',
  },
};
