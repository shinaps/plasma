import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { imageType } from '../shared/image-types.ts';
import { limits } from '../shared/limits.ts';
import type { DiffMode, DiffView, GitEntry, GitKind, GitStatus } from '../shared/protocol.ts';
import { decodeText, imageDataUrl } from './content.ts';
import { insideRoot, posixRelative } from './paths.ts';
import type { Workspace } from './workspace.ts';

/**
 * git を実行する。失敗したときの文言は git の標準エラー出力だけにし、コマンドラインや絶対パスを利用者に見せない。
 * @param env 省略時は現在の環境。GIT_INDEX_FILE など、呼び出しごとの環境を足すときに使う
 */
export function runGit(
  root: string,
  args: string[],
  input?: string,
  env?: NodeJS.ProcessEnv,
): Buffer {
  try {
    return runGitUnchecked(root, args, input, env);
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : '';
    throw new Error(stderr || 'git failed.', { cause: error });
  }
}

function runGitUnchecked(
  root: string,
  args: string[],
  input?: string,
  env?: NodeJS.ProcessEnv,
): Buffer {
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
    {
      maxBuffer: limits.gitOutput,
      input,
      env,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    },
  );
}

/**
 * 開いたリポジトリの .git/config が定義する filter の設定を、その呼び出しの間だけ利用者のグローバル設定の値に
 * 置き換える (グローバルに無ければ空にして無効化する) `-c` 引数。clean filter は stat の食い違うファイルの比較のために
 * git status からも実行されるので、core.fsmonitor と同じく、開いただけのリポジトリの設定を自動で動かさない。
 * グローバル設定にしか無い定義 (通常の git lfs install) はそのまま使う。
 * 置き換えるのはリポジトリが定義したキーだけ。process を空にすると git は clean も見なくなるため、未定義のキーには触れない。
 */
function trustedFilterOverrides(root: string): string[] {
  let scoped: string;
  try {
    scoped = runGitUnchecked(root, ['config', '--show-scope', '-z', '--get-regexp', '^filter\\.'])
      .toString()
      .replace(/\0$/, '');
  } catch {
    // 定義が 1 つも無いと git は 1 で終わる。
    return [];
  }
  const trusted = new Map<string, string>();
  const local = new Set<string>();
  const records = scoped.split('\0');
  for (let i = 0; i + 1 < records.length; i += 2) {
    const [key, value = ''] = records[i + 1].split('\n', 2);
    if (records[i] === 'local' || records[i] === 'worktree') local.add(key);
    else trusted.set(key, value);
  }
  return [...local].flatMap((key) => [
    '-c',
    `${key}=${trusted.get(key) ?? (key.endsWith('.required') ? 'false' : '')}`,
  ]);
}

/**
 * マージ・cherry-pick・revert の途中は、git commit がその状態 (MERGE_HEAD など) を取り込んで完了扱いにする。
 * 選んだ変更だけのコミットでは、その操作の内容を含まないコミットで途中状態が消えるので、書き込む前に止める。
 */
export function assertNoPendingOperation(repository: string): void {
  const pending = runGit(repository, [
    'rev-parse',
    '--path-format=absolute',
    '--git-path',
    'MERGE_HEAD',
    '--git-path',
    'CHERRY_PICK_HEAD',
    '--git-path',
    'REVERT_HEAD',
  ])
    .toString()
    .split('\n')
    .some((file) => file && fs.existsSync(file));
  if (pending)
    throw new Error(
      'A merge, cherry-pick or revert is in progress. Finish or abort it with Git before committing.',
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

export function gitStatus(root: string, visiblePaths: string[] = []): GitStatus {
  let repository: string;
  try {
    repository = runGit(root, ['rev-parse', '--show-toplevel']).toString().trim();
  } catch {
    return { available: false, branch: '', entries: [], ignoredPaths: [] };
  }
  const records = runGit(root, [
    ...trustedFilterOverrides(root),
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
  return { available: true, branch, entries, ignoredPaths: gitIgnoredPaths(root, visiblePaths) };
}

/** Git 自身に判定させることで、否定パターン・入れ子のignore・追跡済みファイルの例外を保つ。 */
function gitIgnoredPaths(root: string, paths: string[]): string[] {
  if (!paths.length) return [];
  try {
    return runGitUnchecked(root, ['check-ignore', '-z', '--stdin'], `${paths.join('\0')}\0`)
      .toString()
      .split('\0')
      .filter(Boolean);
  } catch {
    // 一致なしやサブモジュール内のパスで Git が拒否した場合は、補助的な着色だけを省く。
    // 色の取得失敗で本来の変更一覧まで表示不能にしない。
    return [];
  }
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
  // 内容が空の既存ファイルと、比較元に存在しない新規ファイルを区別する。
  const headExists = entry.index !== '?' && entry.index !== 'A' && entry.working !== 'A';
  const indexExists = entry.index !== '?' && entry.index !== 'D' && entry.working !== 'A';
  // 表示するIDと取得する内容が、途中のHEAD移動で食い違わないよう固定する。
  const revision =
    headExists && mode !== 'working'
      ? runGit(workspace.root, ['rev-parse', 'HEAD']).toString().trim()
      : '';
  const head = (): string =>
    headExists ? blob(`${revision}:${entry.oldPath ?? entry.repoPath}`) : '';
  const index = (): string => (indexExists ? blob(`:${entry.repoPath}`) : '');
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
    originalExists: mode === 'working' ? indexExists : headExists,
    original: mode === 'working' ? index() : head(),
    modified: mode === 'staged' ? index() : current(),
    image,
    editable: !image && mode !== 'staged' && !deletedInWorkingTree,
    inWorkingTree: !deletedInWorkingTree,
    originalLabel: mode === 'working' ? 'Index' : revision.slice(0, 8) || '(empty)',
    originalPath: mode === 'working' ? entry.repoPath : (entry.oldPath ?? entry.repoPath),
    modifiedLabel: mode === 'staged' ? 'Index' : 'Current version',
  };
}

/**
 * 選択したファイルのディスク上の内容だけをコミットし、無関係なステージ済み変更を含めない。
 * @param paths 現在の Git の変更一覧にあるプロジェクト相対パス。一覧にないパスがあれば失敗する
 * @param message コミットメッセージ
 */
export function commitFiles(root: string, paths: string[], message: string): { hash: string } {
  const repository = runGit(root, ['rev-parse', '--show-toplevel']).toString().trim();
  // add が衝突中のファイルを解決済みにしてしまうので、git 自身が commit --only を拒否する前に止める。
  assertNoPendingOperation(repository);
  const status = gitStatus(root);
  const entries = paths.map((file) => {
    const entry = status.entries.find((candidate) => candidate.path === file);
    if (!entry) throw new Error(`No current change for ${file}. Refresh and select again.`);
    return entry;
  });
  // パスは表示対象の変更からだけ採用する。
  const pathspec = `${[
    ...new Set(
      entries.flatMap((entry) => [
        entry.repoPath,
        ...(entry.oldPath && (entry.index === 'R' || entry.working === 'R') ? [entry.oldPath] : []),
      ]),
    ),
  ].join('\0')}\0`;
  // index から既に消えたパス (ステージ済み削除・改名前) は add の対象にしない。
  const stagePaths = entries
    .filter((entry) => entry.index !== 'D' || entry.working !== ' ')
    .map((entry) => entry.repoPath);
  if (stagePaths.length)
    runGit(
      repository,
      ['--literal-pathspecs', 'add', '--all', '--pathspec-from-file=-', '--pathspec-file-nul'],
      `${stagePaths.join('\0')}\0`,
    );
  try {
    runGit(
      repository,
      [
        '--literal-pathspecs',
        'commit',
        '--only',
        '-m',
        message,
        '--pathspec-from-file=-',
        '--pathspec-file-nul',
      ],
      pathspec,
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nSelected files remain staged. Review them before retrying.`,
      { cause: error },
    );
  }
  return { hash: runGit(repository, ['rev-parse', 'HEAD']).toString().trim() };
}

/** リモートやタグの閲覧と、作業ブランチの切り替えを混同しないようローカルだけを返す。 */
export function gitBranches(root: string): { branches: string[] } {
  return {
    branches: runGit(root, ['for-each-ref', '--format=%(refname:strip=2)', 'refs/heads'])
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean),
  };
}

export function switchBranch(root: string, branch: string): { branch: string } {
  // Git が上書きを拒否したらそのまま返す。強制切り替えや暗黙の stash は行わない。
  runGit(root, ['switch', '--no-guess', '--', branch]);
  return { branch: gitStatus(root).branch };
}
