import fs from 'node:fs';
import path from 'node:path';
import { imageType } from '../shared/image-types.ts';
import type { CommitDetail, DiffView, GitEntry, GitHistory, GitKind } from '../shared/protocol.ts';
import { decodeGitContent, runGit } from './git.ts';

/** 1 回の取得で返すコミット数。履歴画面が「さらに読み込む」で継ぎ足す単位。 */
const historyPageSize = 50;
const resolveCommit = (root: string, ref: string): string =>
  runGit(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
    .toString()
    .trim();
// 改名 (R) は内容の比較を見せたいので modified、複写 (C) は新しいファイルとして added に分類する。
const kindOfStatus = {
  A: 'added',
  D: 'deleted',
  R: 'modified',
  C: 'added',
} as const satisfies Record<string, GitKind>;

export function gitHistory(
  root: string,
  options: {
    revisions: string[];
    compareRef?: string;
    compareTip?: string;
    query: string;
    skip: number;
  },
): GitHistory {
  const refRecords = runGit(root, [
    'for-each-ref',
    '--format=%(refname)%00%(symref)',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ])
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\0'));
  const refs = refRecords.map(([ref]) => ref);
  const defaultBase = [
    refRecords.find(([ref]) => ref === 'refs/remotes/origin/HEAD')?.[1],
    'refs/remotes/origin/main',
    'refs/remotes/origin/master',
    ...refRecords
      .filter(([ref]) => /^refs\/remotes\/[^/]+\/HEAD$/.test(ref))
      .map(([, target]) => target),
    'refs/heads/main',
    'refs/heads/master',
  ].find((ref) => ref && refs.includes(ref));
  // 保存された選択に消えたブランチがあっても履歴を止めない。存在する参照とページ送りの commit id だけを使い、
  // 外した参照は missing で知らせる。参照一覧に無い文字列は git に渡さないので、オプションとしても解釈されない。
  const known = (ref: string): boolean =>
    ref === 'HEAD' || refs.includes(ref) || /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(ref);
  const missing = [
    ...options.revisions,
    ...(options.compareRef ? [options.compareRef] : []),
  ].filter((ref) => !known(ref));
  const baseRef =
    options.compareRef && known(options.compareRef) ? options.compareRef : defaultBase;
  const requested = options.revisions.filter(known);
  const selection = requested.length ? requested : ['HEAD', ...(baseRef ? [baseRef] : [])];
  const tips: string[] = [];
  for (const ref of selection) {
    try {
      tips.push(resolveCommit(root, ref));
    } catch (error) {
      // 未作成の HEAD だけは省く。他に選んだブランチがあれば、その履歴を表示できる。
      if (ref !== 'HEAD') throw error;
    }
  }
  if (!tips.length) return { refs, selection, missing, tips, commits: [], hasMore: false };
  const baseTip = baseRef ? resolveCommit(root, options.compareTip || baseRef) : undefined;
  // 日付や描画位置ではなく到達可能性で分類する。マージ済みのコミットを「追加分」と誤認しないため。
  const outside = baseTip
    ? new Set(
        runGit(root, ['rev-list', ...tips, '--not', baseTip, '--'])
          .toString()
          .trim()
          .split('\n')
          .filter(Boolean),
      )
    : undefined;
  const prefix = runGit(root, ['rev-parse', '--show-prefix']).toString().trim();
  const fields = runGit(root, [
    'log',
    '-z',
    '--topo-order',
    // サブディレクトリのパスで絞ったときに省かれたコミットを飛ばして、親子関係をつなぎ直す。
    '--parents',
    '--decorate=full',
    '--format=%H%x00%P%x00%an%x00%aI%x00%s%x00%D',
    `--max-count=${historyPageSize + 1}`,
    `--skip=${options.skip}`,
    '--fixed-strings',
    '--regexp-ignore-case',
    ...(options.query ? [`--grep=${options.query}`] : []),
    ...tips,
    // ルートの履歴には空のコミットも含める。パスで絞るのはサブディレクトリを開いたときだけ。
    '--',
    ...(prefix ? ['.'] : []),
  ])
    .toString()
    .split('\0');
  const commits: GitHistory['commits'] = [];
  for (let i = 0; fields[i]; i += 6) {
    const [id, parents, author, date, subject, decorations] = fields.slice(i, i + 6);
    commits.push({
      id,
      parents: parents.split(' ').filter(Boolean),
      author,
      date,
      subject,
      decorations,
      ...(outside ? { outsideBase: outside.has(id) } : {}),
    });
  }
  return {
    refs,
    selection,
    missing,
    tips,
    comparison:
      baseRef && baseTip && outside
        ? { ref: baseRef, tip: baseTip, outsideCount: outside.size }
        : undefined,
    commits: commits.slice(0, historyPageSize),
    hasMore: commits.length > historyPageSize,
  };
}

export function gitCommit(root: string, ref: string): CommitDetail {
  const id = resolveCommit(root, ref);
  const [parents, author, date, message] = runGit(root, [
    'show',
    '-s',
    '--format=%P%x00%an%x00%aI%x00%B',
    id,
    '--',
  ])
    .toString()
    .trimEnd()
    .split('\0');
  const parent = parents.split(' ').filter(Boolean)[0];
  // マージコミットは第 1 親と比べる。メインラインに入った変更がそのまま見える。
  const records = runGit(root, [
    'diff-tree',
    '--root',
    '--no-commit-id',
    '-r',
    '--name-status',
    '-z',
    '-M',
    ...(parent ? [parent, id] : [id]),
    '--',
    '.',
  ])
    .toString()
    .split('\0');
  const prefix = runGit(root, ['rev-parse', '--show-prefix']).toString().trim();
  const entries: GitEntry[] = [];
  for (let i = 0; records[i]; ) {
    const status = records[i++][0];
    const firstPath = records[i++];
    // 改名と複写は元のパスと新しいパスの 2 つが並ぶ。それ以外はパスが 1 つ。
    const renamed = /[RC]/.test(status);
    const repoPath = renamed ? records[i++] : firstPath;
    if (prefix && !repoPath.startsWith(prefix)) continue;
    entries.push({
      path: repoPath.slice(prefix.length),
      repoPath,
      oldPath: renamed ? firstPath : undefined,
      kind: status in kindOfStatus ? kindOfStatus[status as keyof typeof kindOfStatus] : 'modified',
      index: status,
      working: ' ',
    });
  }
  return { id, parent, author, date, message, entries };
}

export function gitCommitDiff(root: string, ref: string, relative: string): DiffView {
  const commit = gitCommit(root, ref);
  // このコミットで Git が返したファイルだけを対象にする。作業ツリーは読まない。
  const entry = commit.entries.find((item) => item.path === relative);
  if (!entry) throw new Error('Not a file changed in this commit.');
  const blob = (id: string, file: string): string => {
    let bytes: Buffer;
    try {
      bytes = runGit(root, ['cat-file', 'blob', `${id}:${file}`]);
    } catch (error) {
      // サブモジュールは blob ではないので取り出せない。
      throw new Error('This entry is not a file (submodules are not supported).', { cause: error });
    }
    return decodeGitContent(bytes, relative);
  };
  // 比較元は第 1 親の内容。ルートコミットと追加されたファイルには比較元がない。
  const parent = entry.index === 'A' ? undefined : commit.parent;
  return {
    path: relative,
    image: !!imageType(relative),
    editable: false,
    inWorkingTree: !!fs.statSync(path.join(root, relative), { throwIfNoEntry: false })?.isFile(),
    originalExists: parent !== undefined,
    original: parent === undefined ? '' : blob(parent, entry.oldPath ?? entry.repoPath),
    modified: entry.index === 'D' ? '' : blob(commit.id, entry.repoPath),
    originalLabel: commit.parent?.slice(0, 8) ?? '(empty)',
    originalPath: entry.oldPath ?? entry.repoPath,
    modifiedLabel: commit.id.slice(0, 8),
  };
}
