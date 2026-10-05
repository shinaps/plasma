import { createHighlighterCore } from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import css from '@shikijs/langs/css';
import html from '@shikijs/langs/html';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import jsx from '@shikijs/langs/jsx';
import markdown from '@shikijs/langs/markdown';
import tsx from '@shikijs/langs/tsx';
import typescript from '@shikijs/langs/typescript';
import yaml from '@shikijs/langs/yaml';
import { shikiToMonaco } from '@shikijs/monaco';
import * as monaco from 'monaco-editor/editor/editor.api';
import { rendererTheme } from '../../styles/renderer-theme';
import { oneDark } from './themes/one-dark';
import { palette } from './themes/one-dark-palette';
import {
  alwaysBoldTokens,
  alwaysItalicTokens,
  getStandardTokens,
} from './themes/one-dark-textmate';

/**
 * 構文の配色と Monaco のテーマ「workbench」を登録する。
 * shikiToMonaco は同じ名前のテーマを作り直すので、エディタの色はここで一度だけ決める。
 * メニューの色は Monaco の外側に描かれるため base.css の --vscode-menu-* で指定する。
 */
export async function setupHighlighting(): Promise<void> {
  const languages = [typescript, javascript, tsx, jsx, json, markdown, css, html, yaml];
  const theme = rendererTheme();
  const highlighter = await createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    langs: languages,
    themes: [
      {
        name: 'workbench',
        type: 'dark',
        colors: {
          ...oneDark.colors,
          ...theme.diffColors,
          'editor.background': theme.background,
          'editor.foreground': theme.foreground,
        },
        tokenColors: [...getStandardTokens(palette), ...alwaysItalicTokens, ...alwaysBoldTokens],
      },
    ],
  });
  for (const id of highlighter.getLoadedLanguages()) monaco.languages.register({ id });
  shikiToMonaco(highlighter, monaco);
  monaco.editor.setTheme('workbench');
}
