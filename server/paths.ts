import path from 'node:path';

/** file が root 自身か root の中にあるか。境界の判定はすべてこの関数を通す。 */
export function insideRoot(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** root からの相対パスを、OS に関係なく `/` 区切りで返す。クライアントとの契約ではこの形を使う。 */
export function posixRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}
