import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { errorCode } from '../shared/errors.ts';
import { imageType } from '../shared/image-types.ts';
import type { DiffView, GitEntry, PullRequest, PullRequestComparison } from '../shared/protocol.ts';
import { decodeGitContent, runGit } from './git.ts';

const exec = promisify(execFile);
/**
 * ログインシェルの PATH で見つけたプログラムの場所。アプリから起動された MCP サーバーの PATH は最小限のことがあり、
 * 利用者がシェルで使える gh が見つからない。固定の絶対パスは埋め込まず、その環境のシェルに聞く。
 */
const located = new Map<string, Promise<string | undefined>>();
function locate(program: string): Promise<string | undefined> {
  let lookup = located.get(program);
  if (!lookup) {
    lookup = exec(process.env.SHELL || '/bin/sh', ['-lc', `command -v -- ${program}`], {
      encoding: 'utf8',
      timeout: 15_000,
    }).then(
      // プロファイルが標準出力に何か書いても、最後の行がパス。
      ({ stdout }) => stdout.trim().split('\n').at(-1) || undefined,
      () => undefined,
    );
    located.set(program, lookup);
  }
  return lookup;
}
async function command(root: string, program: string, args: string[]): Promise<string> {
  try {
    return (
      await exec(program, args, {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: 120_000,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
      })
    ).stdout;
  } catch (error) {
    if (errorCode(error) === 'ENOENT' && !program.includes('/')) {
      const found = await locate(program);
      if (found) return command(root, found, args);
      throw new Error(
        `${program} was not found in PATH or in your login shell. Install GitHub CLI and sign in with gh auth login.`,
        { cause: error },
      );
    }
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : '';
    throw new Error(
      stderr || `${program} could not run. Install GitHub CLI and sign in with gh auth login.`,
      { cause: error },
    );
  }
}
const gh = async (root: string, args: string[]) => JSON.parse(await command(root, 'gh', args));
async function repository(root: string): Promise<{ nameWithOwner: string; url: string }> {
  return gh(root, ['repo', 'view', '--json', 'nameWithOwner,url']);
}
export async function listPullRequests(
  root: string,
): Promise<{ repository: string; requests: PullRequest[] }> {
  const repo = await repository(root);
  const pages = await gh(root, [
    'api',
    '--paginate',
    '--slurp',
    `repos/${repo.nameWithOwner}/pulls?state=open&per_page=100`,
  ]);
  return {
    repository: repo.nameWithOwner,
    requests: pages
      .flat()
      .map(
        (pr: {
          number: number;
          title: string;
          html_url: string;
          draft: boolean;
          head: { ref: string };
          base: { ref: string };
        }) => ({
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          draft: pr.draft,
          head: pr.head.ref,
          base: pr.base.ref,
        }),
      ),
  };
}
// プロジェクトごとに最後に開いた比較を固定する。未コミット内容や後続のPR更新を混ぜない。
const comparisons = new Map<string, PullRequestComparison>();
export async function openPullRequest(
  root: string,
  number: number,
): Promise<PullRequestComparison> {
  const repo = await repository(root);
  const pr = await gh(root, ['api', `repos/${repo.nameWithOwner}/pulls/${number}`]);
  const repositoryRoot = runGit(root, ['rev-parse', '--show-toplevel']).toString().trim();
  // refs/heads・index・作業ツリー・FETCH_HEADを変更せず、オブジェクトだけ取得する。
  await command(repositoryRoot, 'git', [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'credential.helper=',
    '-c',
    'credential.helper=!gh auth git-credential',
    'fetch',
    '--no-tags',
    '--no-write-fetch-head',
    '--no-recurse-submodules',
    repo.url,
    pr.base.sha,
    pr.head.sha,
  ]);
  if (runGit(repositoryRoot, ['rev-parse', '--is-shallow-repository']).toString().trim() === 'true')
    throw new Error(
      'PR comparisons need complete Git history. Unshallow this repository and try again.',
    );
  const mergeBase = runGit(repositoryRoot, ['merge-base', pr.base.sha, pr.head.sha])
    .toString()
    .trim();
  const entries = comparisonEntries(repositoryRoot, mergeBase, pr.head.sha);
  const comparison: PullRequestComparison = {
    id: randomUUID(),
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    draft: pr.draft,
    base: pr.base.ref,
    head: pr.head.ref,
    baseCommit: mergeBase,
    headCommit: pr.head.sha,
    repositoryRoot,
    entries,
  };
  comparisons.set(root, comparison);
  return comparison;
}
export function comparisonEntries(root: string, base: string, head: string): GitEntry[] {
  const records = runGit(root, ['diff', '--name-status', '-z', '-M', base, head, '--'])
    .toString()
    .split('\0');
  const entries: GitEntry[] = [];
  for (let i = 0; records[i]; ) {
    const status = records[i++][0];
    const first = records[i++];
    const renamed = status === 'R';
    const file = renamed ? records[i++] : first;
    entries.push({
      path: file,
      repoPath: file,
      oldPath: renamed ? first : undefined,
      index: status,
      working: ' ',
      kind: status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified',
    });
  }
  return entries;
}
export function pullRequestDiff(root: string, id: string, file: string): DiffView {
  const comparison = comparisons.get(root);
  if (!comparison || comparison.id !== id)
    throw new Error('This PR comparison has expired. Select the pull request again.');
  const entry = comparison.entries.find((item) => item.path === file);
  if (!entry) throw new Error('Not a file changed in this pull request.');
  const blob = (commit: string, path: string) =>
    decodeGitContent(
      runGit(comparison.repositoryRoot, ['cat-file', 'blob', `${commit}:${path}`]),
      file,
    );
  return {
    path: file,
    originalExists: entry.index !== 'A',
    original: entry.index === 'A' ? '' : blob(comparison.baseCommit, entry.oldPath ?? file),
    modified: entry.index === 'D' ? '' : blob(comparison.headCommit, file),
    originalPath: entry.oldPath ?? file,
    originalLabel: `${comparison.base} · ${comparison.baseCommit.slice(0, 8)}`,
    modifiedLabel: `${comparison.head} · ${comparison.headCommit.slice(0, 8)}`,
    image: !!imageType(file),
    editable: false,
    inWorkingTree: false,
  };
}
