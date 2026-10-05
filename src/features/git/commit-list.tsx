import { useMemo } from 'react';
import { layoutCommits } from '../../../shared/git-graph.ts';
import type { GitHistory, HistoryCommit } from '../../../shared/protocol.ts';
import { formatCommitDate } from './commit-date';
import { CommitGraph } from './commit-graph';

type Props = {
  commits: HistoryCommit[];
  filtered: boolean;
  selected: string;
  comparison?: GitHistory['comparison'];
  onSelect: (commit: HistoryCommit) => void;
};

export function CommitList({ commits, filtered, selected, comparison, onSelect }: Props) {
  const graph = useMemo(() => layoutCommits(commits), [commits]);
  const renderRow = (commit: HistoryCommit, index: number) => (
    <button
      key={commit.id}
      type="button"
      aria-pressed={selected === commit.id}
      onClick={() => onSelect(commit)}
      title={`${commit.subject}\n${commit.id}\n${commit.author} · ${formatCommitDate(commit.date)}`}
      className={`flex h-git-log-row w-full items-center gap-2 rounded-control border-0 px-2 text-left text-caption text-foreground ${selected === commit.id ? 'bg-accent' : commit.outsideBase ? 'bg-primary/5 hover:bg-accent/50' : 'bg-transparent hover:bg-accent/50'}`}
    >
      {!filtered && (
        <CommitGraph
          row={graph.rows[index]}
          lanes={graph.lanes}
          merge={commit.parents.length > 1}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{commit.subject || '(no message)'}</span>
      {comparison && (
        <span
          className={`w-20 shrink-0 truncate text-caption ${commit.outsideBase ? 'text-primary' : 'text-muted-foreground'}`}
          title={
            commit.outsideBase
              ? `Not reachable from ${comparison.ref}`
              : `Included in ${comparison.ref}`
          }
        >
          {commit.id === comparison.tip
            ? 'Base tip'
            : commit.outsideBase
              ? 'Branch only'
              : 'In base'}
        </span>
      )}
      <span
        className="flex w-[24%] max-w-48 shrink-0 items-center gap-1 overflow-hidden"
        title={commit.decorations}
      >
        {commit.decorations
          .split(', ')
          .filter((ref) => ref && !/^refs\/remotes\/[^/]+\/HEAD$/.test(ref))
          .map((ref) => (
            <span
              key={ref}
              title={ref}
              className={`min-w-0 max-w-72 truncate rounded-control px-1.5 py-0.5 text-caption ${ref.startsWith('refs/remotes/') ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary'}`}
            >
              {ref
                .replace(/^tag: /, '')
                .replace(/refs\/(heads|remotes|tags)\//g, '')
                .replace(/^HEAD -> /, 'HEAD · ')}
            </span>
          ))}
      </span>
      <span className="w-16 shrink-0 font-mono text-caption text-muted-foreground">
        {commit.id.slice(0, 7)}
      </span>
      <span className="hidden w-28 shrink-0 truncate text-muted-foreground @2xl:block">
        {commit.author}
      </span>
      <time
        className="hidden w-[18ch] shrink-0 whitespace-nowrap text-right text-caption tabular-nums text-muted-foreground @md:block"
        dateTime={commit.date}
      >
        {formatCommitDate(commit.date)}
      </time>
    </button>
  );
  if (!commits.length) return null;
  // 一覧の幅が足りないときは Author、次に Date を隠し、Message の列を残す。幅はコンテナ (Commits 区画) で判定する。
  return (
    <div>
      <div className="sticky top-0 z-10 flex h-git-log-row items-center gap-2 bg-background px-2 text-caption text-muted-foreground">
        {!filtered && <span style={{ width: graph.lanes * 20 }} className="shrink-0" />}
        <span className="min-w-0 flex-1">Message</span>
        {comparison && <span className="w-20 shrink-0">vs. base</span>}
        <span className="w-[24%] max-w-48 shrink-0">Branches / Tags</span>
        <span className="w-16 shrink-0">Hash</span>
        <span className="hidden w-28 shrink-0 @2xl:block">Author</span>
        <span className="hidden w-[18ch] shrink-0 text-right @md:block">Date</span>
      </div>
      {commits.map(renderRow)}
    </div>
  );
}
