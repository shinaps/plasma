import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { imageType } from '../shared/image-types.ts';
import { limits } from '../shared/limits.ts';
import type { DiffMode, DiffView, GitEntry, GitKind, GitStatus } from '../shared/protocol.ts';
import { decodeText, imageDataUrl } from './content.ts';
import { insideRoot, posixRelative } from './paths.ts';
import type { Workspace } from './workspace.ts';

/** git を実行する。失敗したときの文言は git の標準エラー出力だけにし、コマンドラインや絶対パスを利用者に見せない。 */
export function runGit(root: string, args: string[]): Buffer {
  try {
    return runGitUnchecked(root, args);
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : '';
    throw new Error(stderr || 'git failed.', { cause: error });
  }
}

function runGitUnchecked(root: string, args: string[]): Buffer {
  return execFileSync(
    'git',
    [
      // 開いたリポジトリの .git/config にある core.fsmonitor のコマンドを実行しない。
      // git status は 5 秒ごとに自動で呼ぶので、展開しただけのリポジトリの設定が勝手に動いてはいけない。
      '-c',
      'core.fsmonitor=false',
      // 自動実行の status が index を書き換えて、ユーザーの git 操作と競合しないようにする。
      '--no-optional-locks',
      '-C',
      root,
      ...args,
    ],
    { maxBuffer: limits.gitOutput, stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

/**
 * Git から読んだ内容を差分表示用の文字列にする。
 * @param bytes blob の内容
 * @param file 拡張子から画像かどうかを判定するためのパス
 */
export function decodeGitContent(bytes: Buffer, file: string): string {
  return imageType(file) ? imageDataUrl(bytes, file) : decodeText(bytes);
}

export function gitStatus(root: string): GitStatus {
  let repository: string;
  try {
    repository = runGit(root, ['rev-parse', '--show-toplevel']).toString().trim();
  } catch {
    return { available: false, branch: '', entries: [] };
  }
  const records = runGit(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    '.',
  ])
    .toString()
    .split('\0');
  const entries: GitEntry[] = [];
  for (let i = 0; i < records.length && records[i]; i++) {
    const record = records[i];
    const index = record[0];
    const working = record[1];
    const repoPath = record.slice(3);
    const oldPath = /[RC]/.test(index + working) ? records[++i] : undefined;
    const file = path.join(repository, repoPath);
    if (!insideRoot(root, file)) continue;
    // サブモジュールや入れ子のリポジトリはディレクトリとして現れる。差分を出せないので一覧に載せない。
    if (fs.lstatSync(file, { throwIfNoEntry: false })?.isDirectory()) continue;
    const kind: GitKind =
      index === '?'
        ? 'untracked'
        : /U/.test(index + working) || ['AA', 'DD'].includes(index + working)
          ? 'conflict'
          : /D/.test(index + working)
            ? 'deleted'
            : index === 'A'
              ? 'added'
              : 'modified';
    entries.push({ path: posixRelative(root, file), repoPath, oldPath, index, working, kind });
  }
  let branch: string;
  try {
    branch = runGit(root, ['symbolic-ref', '--short', 'HEAD']).toString().trim();
  } catch {
    branch = runGit(root, ['rev-parse', '--short', 'HEAD']).toString().trim();
  }
  return { available: true, branch, entries };
}

/**
 * 作業ツリーのファイルを HEAD や index と比べる。
 * @param workspace パスの境界検査と作業ツリーの読み込みに使う
 * @param relative プロジェクトからの相対パス
 * @param mode all は HEAD と作業ツリー、working は index と作業ツリー、staged は HEAD と index
 */
export function gitDiff(workspace: Workspace, relative: string, mode: DiffMode): DiffView {
  const state = gitStatus(workspace.root);
  // 比較するパスと改名元は Git の status から取る。クライアントが指定した任意のリビジョンは使わない。
  const entry = state.entries.find((candidate) => candidate.path === relative);
  if (!entry) throw new Error('This file no longer has Git changes. Refresh the list.');
  if (entry.kind === 'conflict')
    throw new Error('Conflicted file. Three-way merge view is not supported.');
  const blob = (spec: string): string =>
    decodeGitContent(runGit(workspace.root, ['show', spec]), relative);
  const head = (): string =>
    // intent-to-add (git add -N) は index が空で作業ツリーが A。HEAD には無い。
    entry.index === '?' || entry.index === 'A' || entry.working === 'A'
      ? ''
      : blob(`HEAD:${entry.oldPath ?? entry.repoPath}`);
  const index = (): string =>
    entry.index === '?' || entry.index === 'D' ? '' : blob(`:${entry.repoPath}`);
  const image = !!imageType(relative);
  const deletedInWorkingTree =
    entry.working === 'D' || (entry.index === 'D' && entry.working === ' ');
  const current = (): string =>
    deletedInWorkingTree
      ? ''
      : image
        ? workspace.imageRead(relative).src
        : workspace.read(relative).text;
  return {
    path: relative,
    original: mode === 'working' ? index() : head(),
    modified: mode === 'staged' ? index() : current(),
    image,
    editable: !image && mode !== 'staged' && !deletedInWorkingTree,
    inWorkingTree: !deletedInWorkingTree,
    originalLabel: mode === 'working' ? 'Index' : 'HEAD',
    modifiedLabel: mode === 'staged' ? 'Index' : 'Working tree',
  };
}
