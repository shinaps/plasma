import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** MCP の描画環境ではアイコンフォントを使えないため、同じ Codicons の SVG を埋め込む。 */
export function monacoIcons(): Plugin {
  const id = 'virtual:monaco-icons.css';
  const directory = fileURLToPath(
    new URL('../node_modules/@vscode/codicons/src/icons/', import.meta.url),
  );
  return {
    name: 'monaco-svg-icons',
    resolveId(source) {
      if (source === id) return `\0${id}`;
    },
    load(source) {
      if (source !== `\0${id}`) return;
      const files = fs.readdirSync(directory).filter((file) => file.endsWith('.svg'));
      const rules = files
        .map((file) => {
          const name = path.basename(file, '.svg');
          const svg = fs.readFileSync(path.join(directory, file), 'utf8');
          const url = `url("data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}")`;
          return `.monaco-editor .codicon.codicon-${name}::before { --plasma-icon: ${url}; }`;
        })
        .join('\n');
      const selectors = files
        .map((file) => `.monaco-editor .codicon.codicon-${path.basename(file, '.svg')}::before`)
        .join(',');
      return `${rules}\n${selectors} { content: ""; display: inline-block; width: 16px; height: 16px; background-color: currentColor; mask: var(--plasma-icon) center / contain no-repeat; }`;
    },
  };
}
