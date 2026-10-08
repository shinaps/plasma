import fs from 'node:fs';
import path from 'node:path';
import { insideRoot, posixRelative } from './paths.ts';

/**
 * 変更してよいプロジェクト内のパスを絶対パスで返す。
 * ルート自身・Git 内部・シンボリックリンク経由のパスは例外を投げる。
 */
function resolveMutableTarget(root: string, relative: string): string {
  const file = path.resolve(root, relative);
  if (path.isAbsolute(relative) || file === root || !insideRoot(root, file))
    throw new Error('Choose a path inside this project.');
  const parts = posixRelative(root, file).split('/');
  if (parts.some((part) => part.toLowerCase() === '.git'))
    throw new Error('Git metadata cannot be changed from the Project tree.');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink())
      throw new Error('Symbolic links cannot be changed from the Project tree.');
  }
  return file;
}

/** 再帰操作が隠れたリンクやネストしたリポジトリを巻き込まないよう、対象全体の境界を確認する。 */
function checkTree(file: string): void {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
    throw new Error('Only regular files and folders can be changed.');
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(file)) {
      if (name.toLowerCase() === '.git')
        throw new Error('A folder containing Git metadata cannot be changed.');
      checkTree(path.join(file, name));
    }
  }
}

export function createEntry(root: string, relative: string, directory: boolean): { path: string } {
  const file = resolveMutableTarget(root, relative);
  if (directory) fs.mkdirSync(file);
  else fs.writeFileSync(file, '', { flag: 'wx' });
  return { path: posixRelative(root, file) };
}

/**
 * ファイルやフォルダを移動またはコピーする。
 * @param source 元のプロジェクト相対パス
 * @param destination 移動・コピー後のプロジェクト相対パス (親フォルダではない)。既にあれば失敗する
 * @param move true なら移動、false ならコピー
 */
export function transferEntry(
  root: string,
  source: string,
  destination: string,
  move: boolean,
): { path: string } {
  const from = resolveMutableTarget(root, source);
  const to = resolveMutableTarget(root, destination);
  if (insideRoot(from, to)) throw new Error('Choose a destination outside the source folder.');
  checkTree(from);
  // 排他的に宛先を確保する。存在確認だけでは、確認と rename の間に作られた項目を上書きし得る。
  const sourceStat = fs.lstatSync(from);
  const directory = sourceStat.isDirectory();
  if (directory) fs.mkdirSync(to, { mode: 0o700 });
  else if (move) fs.linkSync(from, to);
  else fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  try {
    if (directory) {
      if (move) fs.renameSync(from, to);
      else {
        fs.cpSync(from, to, {
          recursive: true,
          force: false,
          errorOnExist: true,
          preserveTimestamps: true,
        });
        // 予約したフォルダにも元のアクセス権を適用する。コピー中の本文を他ユーザーへ公開しない。
        fs.chmodSync(to, sourceStat.mode);
      }
    } else if (move) fs.unlinkSync(from);
  } catch (error) {
    // この操作が作った宛先だけを取り消す。失敗したコピーを完成品として残さない。
    fs.rmSync(to, { recursive: true, force: true });
    throw error;
  }
  return { path: posixRelative(root, to) };
}

export function deleteEntry(root: string, relative: string): Record<string, never> {
  const file = resolveMutableTarget(root, relative);
  checkTree(file);
  fs.rmSync(file, { recursive: true });
  return {};
}
