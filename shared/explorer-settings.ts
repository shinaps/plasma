// 依存や生成物のツリーはソースの構造を隠し、数百万ファイルを含むことがある。
export const defaultExcludedPaths: string[] = [];

export const defaultAnalysisExcludedPaths = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.build',
  'DerivedData',
  '.next',
  '.turbo',
  '.cache',
];

/**
 * フォルダ名は全階層、./ 付きとスラッシュを含む指定はプロジェクト相対パスに一致する。
 * @param relative プロジェクト相対パス
 * @param directory relative 自身がフォルダか。true なら末尾の名前もフォルダ名として照合する
 * @param exclusions 設定の 1 行ずつの指定
 */
export function isExcludedPath(
  relative: string,
  directory: boolean,
  exclusions: string[],
): boolean {
  const parts = relative.split('/');
  return exclusions.some((entry) => {
    if (entry.startsWith('./') || entry.includes('/')) {
      const target = entry.replace(/^\.\//, '');
      return relative === target || relative.startsWith(`${target}/`);
    }
    return relative === entry || parts.slice(0, directory ? parts.length : -1).includes(entry);
  });
}
