export const iconClassName =
  'inline-flex size-4 shrink-0 items-center justify-center text-current [&_svg]:size-full [&_img]:size-full';
const shapes = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  'open-file': '<path d="M14 2H5v20h14V12M14 2v6h5M13 13l8-8m-6 0h6v6"/>',
  wrap: '<path d="M3 6h18M3 12h13a4 4 0 0 1 0 8h-4m3-3-3 3 3 3M3 18h4"/>',
  code: '<path d="m8 5-7 7 7 7m8-14 7 7-7 7"/>',
  split: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M12 3v18"/>',
  preview:
    '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="m9 3 1-1h4l1 3 3 1 3 2-1 3v2l1 3-3 2-3 1-1 3h-4l-1-3-3-1-3-2 1-3v-2L3 8l3-2 3-1z"/>',
  home: '<path d="m3 10 9-7 9 7v11H3zM9 21v-8h6v8"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3m6 0h5"/>',
  project: '<rect x="2" y="4" width="20" height="15" rx="2"/><path d="M2 8h20M7 8v11"/>',
  git: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M18 7v2c0 5-12 2-12 7"/>',
  expand: '<path d="m7 8 5-5 5 5M7 16l5 5 5-5M4 12h16"/>',
  collapse: '<path d="m7 4 5 5 5-5M7 20l5-5 5 5M4 12h16"/>',
  locate: '<circle cx="12" cy="12" r="6"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',
  refresh: '<path d="M20 7a8 8 0 1 0 1 8M20 2v6h-6"/>',
  file: '<path d="M5 2h9l5 5v15H5zM14 2v6h5"/>',
} as const satisfies Record<string, string>;
export type IconName = keyof typeof shapes;
export function iconMarkup(name: IconName): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${shapes[name]}</svg>`;
}
export function icon(name: IconName): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = iconClassName;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = iconMarkup(name);
  return span;
}
// 素材を埋め込むことで、単体の MCP 画面が外部の画像を取りに行かずに済む。
const materialIcons = import.meta.glob<string>('../assets/atom-material/*.svg', {
  eager: true,
  query: '?inline',
  import: 'default',
});
const extensions: Record<string, string> = {
  ts: 'typeScript',
  mts: 'typeScript',
  cts: 'typeScript',
  tsx: 'react',
  jsx: 'react',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  html: 'html',
  sh: 'shell',
  sql: 'sql',
  tf: 'terraform',
  lock: 'lock',
};
const filenames: Record<string, string> = {
  'package.json': 'npm',
  'package-lock.json': 'npmlock',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-workspace.yaml': 'pnpm',
  '.gitignore': 'gitignore',
  '.gitattributes': 'gitignore',
  dockerfile: 'docker',
  'compose.yaml': 'dockercompose',
  'docker-compose.yml': 'dockercompose',
  'biome.json': 'biome',
  'biome.jsonc': 'biome',
  'lefthook.yml': 'lefthook',
};
const folders: Record<string, string> = {
  src: 'src',
  lib: 'lib',
  components: 'components',
  apps: 'app',
  app: 'app',
  packages: 'packages',
  docs: 'docs',
  '.github': 'github',
  '.idea': 'idea',
  scripts: 'scripts',
  tools: 'tools',
  test: 'tests',
  tests: 'tests',
  __tests__: 'tests',
  api: 'api',
  web: 'web',
  routes: 'routes',
};
function fileType(name: string): string {
  if (filenames[name]) return filenames[name];
  if (/^readme(?:\.|$)/.test(name)) return 'readme_dark';
  if (/^\.env(?:\.|$)/.test(name)) return 'envs';
  if (/^tsconfig(?:\.|$)/.test(name)) return 'tsconfig';
  if (/^vite\.config\./.test(name)) return 'vite';
  if (/^vitest\.config\./.test(name)) return 'vitest';
  if (/\.(test|spec)\.[cm]?ts$/.test(name)) return 'testts';
  if (/\.(test|spec)\.[cm]?js$/.test(name)) return 'testjs';
  return extensions[name.split('.').at(-1) ?? ''] ?? 'default';
}
export function fileIconSource(path: string, folder = false): string {
  const name = (path.split('/').at(-1) ?? '').toLowerCase();
  const type = folder ? (folders[name] ?? 'default') : fileType(name);
  return materialIcons[`../assets/atom-material/${folder ? 'folders' : 'files'}-${type}.svg`];
}
