// 拡張子と Monaco の言語 ID の対応。サーバーの解析対象の判定もこの表から導く。
const languages = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  css: 'css',
  html: 'html',
} as const satisfies Record<string, string>;

/** TypeScript の言語サービスで解析する言語。 */
export const semanticLanguages: readonly string[] = ['typescript', 'javascript', 'tsx', 'jsx'];

export function languageFor(path: string): string {
  const extension = path.split('.').at(-1) ?? '';
  return Object.hasOwn(languages, extension)
    ? languages[extension as keyof typeof languages]
    : 'plaintext';
}

/** TypeScript の言語サービスで解析する言語のファイルか (semanticLanguages に含まれる言語)。CSS や HTML は含まない。 */
export function isSource(path: string): boolean {
  return semanticLanguages.includes(languageFor(path));
}
