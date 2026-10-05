import { ChevronDown, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../../shared/errors.ts';
import { limits } from '../../../shared/limits.ts';
import type {
  CommitDetail,
  GitHistory,
  HistoryCommit,
  SendRequest,
} from '../../../shared/protocol.ts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { renderReact, unmountReact } from '../../lib/react-view';
import { BranchTree } from './branch-tree';
import { formatCommitDate } from './commit-date';
import { CommitList } from './commit-list';
import { GitTree } from './git-tree';
import { readHistoryPreferences, saveHistoryPreferences } from './history-preferences';

type Props = {
  root: string;
  request: SendRequest;
  onClose: () => void;
  /** ブランチやコミットの選択が変わるたびに呼ぶ。呼び出し側は表示中の差分を閉じる */
  onSelect: () => void;
  /** 変更ファイルを選んだときに呼ぶ。ref はそのコミットの ID */
  onFile: (path: string, ref: string) => void;
};
type DetailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; detail: CommitDetail };
const buttonStyle =
  'rounded-control border-0 bg-transparent p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40';

function CommitFiles({ detail, onFile }: { detail: CommitDetail; onFile: Props['onFile'] }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    const tree = new GitTree(element, (path) => {
      tree.update(detail.entries, path, true);
      onFile(path, detail.id);
    });
    tree.update(detail.entries, '', true);
    tree.setAllExpanded(true);
    return () => unmountReact(element);
  }, [detail, onFile]);
  return <div ref={host} className="min-h-0 flex-1 overflow-auto" />;
}

function GitHistoryPanel({ root, request, onClose, onSelect, onFile }: Props) {
  // 取得条件。tip と skip はページ送り、refresh は同じ条件で取り直すためのカウンタ。
  const [historyQuery, setHistoryQuery] = useState(() => ({
    ...readHistoryPreferences(root),
    compareTip: '',
    query: '',
    skip: 0,
    tips: [] as string[],
    refresh: 0,
  }));
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<GitHistory>({
    refs: [],
    selection: [],
    commits: [],
    tips: [] as string[],
    hasMore: false,
  });
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<DetailState>({ status: 'idle' });
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setHistoryError('');
    void request({
      op: 'git-history',
      revisions: historyQuery.tips.length ? historyQuery.tips : historyQuery.revisions,
      compareRef: historyQuery.compareRef || undefined,
      compareTip: historyQuery.compareTip || undefined,
      query: historyQuery.query,
      skip: historyQuery.skip,
    })
      .then((result) => {
        if (!current) return;
        setHistory((previous) => ({
          ...result,
          commits: historyQuery.skip ? [...previous.commits, ...result.commits] : result.commits,
        }));
      })
      .catch((error: unknown) => {
        if (current) setHistoryError(errorMessage(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [request, historyQuery]);

  useEffect(() => {
    if (!selected) {
      setDetail({ status: 'idle' });
      return;
    }
    let current = true;
    setDetail({ status: 'loading' });
    void request({ op: 'git-commit', ref: selected })
      .then((value) => {
        if (current) setDetail({ status: 'loaded', detail: value });
      })
      .catch((error: unknown) => {
        if (current) setDetail({ status: 'error', message: errorMessage(error) });
      });
    return () => {
      current = false;
    };
  }, [request, selected]);

  // 検索欄の内容を使う。更新やブランチの切り替えで、欄の表示と一覧の条件がずれないようにする。
  const selection = historyQuery.revisions.length ? historyQuery.revisions : history.selection;
  function changeFilter(
    revisions = selection,
    query = search.trim(),
    compareRef = historyQuery.compareRef,
  ): void {
    saveHistoryPreferences(root, { revisions, compareRef });
    onSelect();
    setSelected('');
    setHistory((previous) => ({ ...previous, commits: [], comparison: undefined, hasMore: false }));
    setLoading(true);
    setHistoryQuery({
      revisions,
      query,
      compareRef,
      compareTip: '',
      skip: 0,
      tips: [],
      refresh: historyQuery.refresh + 1,
    });
  }
  function selectCommit(commit: HistoryCommit): void {
    if (commit.id === selected) return;
    onSelect();
    setSelected(commit.id);
  }
  return (
    <section
      aria-label="Git History"
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-panel bg-surface text-caption text-foreground"
    >
      <header className="flex shrink-0 items-center gap-3 px-3 py-2">
        <strong className="font-medium">Git · History</strong>
        <form
          className="flex flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            changeFilter(selection, search.trim());
          }}
        >
          <input
            aria-label="Search commit messages"
            placeholder="Search commit messages…"
            value={search}
            maxLength={limits.historyQuery}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full max-w-sm rounded-control border-0 bg-background px-2.5 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
        </form>
        <button
          type="button"
          className={buttonStyle}
          title="Refresh History"
          aria-label="Refresh History"
          onClick={() => changeFilter()}
        >
          <RefreshCw size={14} />
        </button>
        <button
          type="button"
          className={buttonStyle}
          title="Close History"
          aria-label="Close History"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 text-caption">
        <span className="text-muted-foreground">Compare with</span>
        <Select
          value={historyQuery.compareRef || 'auto'}
          onValueChange={(ref) => changeFilter(selection, search.trim(), ref === 'auto' ? '' : ref)}
        >
          <SelectTrigger size="sm" aria-label="Comparison base" className="max-w-64 text-caption">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Default branch</SelectItem>
            {history.refs
              .filter((ref) => !/\/HEAD$/.test(ref))
              .map((ref) => (
                <SelectItem key={ref} value={ref}>
                  {ref.replace(/^refs\/(heads|remotes|tags)\//, '')}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {history.comparison ? (
          <>
            <span
              className="text-primary"
              title="Commits reachable from the selected branches but not from the comparison base. Counts cover the entire repository, regardless of search or folder filters."
            >
              {history.comparison.outsideCount} branch-only commits
            </span>
            <span className="text-muted-foreground" title={history.comparison.tip}>
              Base: {history.comparison.ref.replace(/^refs\/(heads|remotes|tags)\//, '')} ·{' '}
              {history.comparison.tip.slice(0, 7)}
            </span>
            {!selection.includes(history.comparison.ref) && (
              <button
                type="button"
                className={buttonStyle}
                onClick={() => changeFilter([...selection, history.comparison?.ref ?? 'HEAD'])}
              >
                Show base in graph
              </button>
            )}
            {history.comparison.ref.startsWith('refs/remotes/') && (
              <span className="ml-auto text-muted-foreground">
                Local remote snapshot · no auto-fetch
              </span>
            )}
          </>
        ) : (
          !loading && <span className="text-muted-foreground">Choose a comparison branch</span>
        )}
      </div>
      {historyError && (
        <p role="alert" className="m-0 max-h-16 overflow-auto px-3 py-2 text-destructive">
          {historyError}
        </p>
      )}
      <div
        className={`grid min-h-0 flex-1 gap-2 overflow-x-auto px-2 pb-2 ${selected ? 'grid-cols-[minmax(160px,18%)_minmax(360px,1fr)_minmax(220px,28%)]' : 'grid-cols-[minmax(160px,18%)_minmax(360px,1fr)]'}`}
      >
        <nav
          aria-label="History branch"
          className="overflow-auto rounded-control bg-background p-1"
        >
          <div className="flex items-center justify-between gap-1 px-2 py-1 text-muted-foreground">
            <span>Show branches · {selection.length}</span>
            <button
              type="button"
              className={buttonStyle}
              title="Restore current and default branches"
              onClick={() => changeFilter([], search.trim(), '')}
            >
              Reset
            </button>
          </div>
          <BranchTree
            refs={history.refs}
            selected={selection}
            onSelect={(ref) => {
              const next = selection.includes(ref)
                ? selection.filter((item) => item !== ref)
                : [...selection, ref];
              if (next.length) changeFilter(next);
            }}
          />
        </nav>
        <section
          aria-label="Commits"
          aria-busy={loading}
          className="@container min-w-0 overflow-auto rounded-control bg-background px-1 pb-1"
        >
          <CommitList
            key={`${historyQuery.revisions.join(',')}:${historyQuery.query}:${historyQuery.refresh}`}
            commits={history.commits}
            filtered={!!historyQuery.query}
            selected={selected}
            comparison={history.comparison}
            onSelect={selectCommit}
          />
          {loading && (
            <p role="status" className="px-3 text-muted-foreground">
              Loading…
            </p>
          )}
          {!loading && !historyError && !history.commits.length && (
            <p className="px-3 text-muted-foreground">
              {historyQuery.query ? 'No matching commits' : 'No commits yet'}
            </p>
          )}
          {!loading && history.hasMore && (
            <button
              type="button"
              className={`${buttonStyle} mx-auto flex items-center gap-1`}
              onClick={() => {
                setLoading(true);
                setHistoryQuery({
                  ...historyQuery,
                  revisions: selection,
                  tips: history.tips,
                  compareRef: history.comparison?.ref ?? historyQuery.compareRef,
                  compareTip: history.comparison?.tip ?? '',
                  skip: history.commits.length,
                });
              }}
            >
              <ChevronDown size={14} />
              Load More
            </button>
          )}
        </section>
        <section
          className={`${selected ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col rounded-control bg-background p-2`}
          hidden={!selected}
          aria-label="Commit details"
        >
          {detail.status === 'error' && (
            <p role="alert" className="m-0 px-2 py-1 text-destructive">
              {detail.message}
            </p>
          )}
          {detail.status === 'loaded' ? (
            <>
              <CommitFiles detail={detail.detail} onFile={onFile} />
              <div className="mt-2 max-h-[45%] shrink-0 overflow-auto px-2">
                <p className="m-0 whitespace-pre-wrap break-words text-caption">
                  {detail.detail.message}
                </p>
                <p className="mb-0 break-all text-caption text-muted-foreground">
                  {detail.detail.id.slice(0, 8)} · {detail.detail.author}
                  <br />
                  {formatCommitDate(detail.detail.date)}
                  {detail.detail.parent && (
                    <>
                      <br />
                      Compare with: {detail.detail.parent.slice(0, 8)} (first parent)
                    </>
                  )}
                </p>
              </div>
            </>
          ) : (
            detail.status !== 'error' && (
              <p className="px-2 text-muted-foreground">
                {detail.status === 'loading' ? 'Loading…' : 'Select a commit'}
              </p>
            )
          )}
        </section>
      </div>
    </section>
  );
}

export function showGitHistory(host: HTMLElement, props: Props): void {
  renderReact(host, <GitHistoryPanel {...props} />);
}
