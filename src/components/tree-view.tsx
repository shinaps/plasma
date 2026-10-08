import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { GitKind } from '../../shared/protocol.ts';
import { FileIcon } from './icons';
import { Button } from './ui/button';

export type TreeRow = {
  id: string;
  parentId?: string;
  path: string;
  label: string;
  description?: string;
  level: number;
  /** フォルダなら開閉の状態。ファイルなら undefined */
  expanded?: boolean;
  /** false なら左矢印で閉じない (検索中など、開閉を利用者に任せない表示) */
  collapsible?: boolean;
  /** 「Changes」のような見出し行。アイコンを持たず、太字で間隔を空けて表示する */
  group?: boolean;
  status?: GitKind;
  ignored?: boolean;
  analysisExcluded?: boolean;
  /** ツールチップ。改名元のように、ラベルに出さない補足を示す */
  title?: string;
  /** フォルダに含まれるファイル数。ラベルの横に表示する */
  count?: number;
  selected?: boolean;
  icon?: ReactNode;
};
const statusColor = {
  modified: 'text-modified',
  added: 'text-success',
  untracked: 'text-untracked',
  deleted: 'text-deleted line-through',
  conflict: 'text-warning',
} satisfies Record<GitKind, string>;
type Props = {
  label: string;
  multiselect?: boolean;
  /** ファイル一覧は選択と開く操作を分ける。参照の切り替えなどは single を使う。 */
  activation?: 'single' | 'double';
  rows: TreeRow[];
  emptyMessage: string;
  /** 表示してフォーカスを移す行。同じ id をもう一度表示し直すときは revision を進める */
  reveal?: { id: string; revision: number };
  /** 指定したクリック操作か Enter / Space で呼ぶ。フォルダなら開閉、ファイルなら開く */
  onActivate: (row: TreeRow) => void;
  /** 行にフォーカスが移ったときに呼ぶ。「選択中のフォルダを展開」の対象を知らせる */
  onSelect?: (row: TreeRow) => void;
  renderControl?: (row: TreeRow) => ReactNode;
  renderRow?: (row: TreeRow, button: ReactElement) => ReactNode;
};

/** 行の表示・キーボード操作・フォーカスを担当する。どの行を表示するかと開閉の状態は呼び出し側が決める。 */
export function TreeView({
  label,
  multiselect,
  activation = 'double',
  rows,
  emptyMessage,
  reveal,
  onActivate,
  onSelect,
  renderRow,
  renderControl,
}: Props): ReactNode {
  const [focusedId, setFocusedId] = useState<string>();
  const [appliedReveal, setAppliedReveal] = useState<number>();
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const container = useRef<HTMLDivElement>(null);
  const focusWithin = useRef(false);
  const fallbackId = rows.find((row) => row.selected)?.id ?? rows[0]?.id;
  const tabStop = rows.some((row) => row.id === focusedId) ? focusedId : fallbackId;

  // reveal が変わったら、描画中にフォーカス先を更新する。DOM の操作だけを後の effect に残す。
  const revealPending = reveal && reveal.revision !== appliedReveal;
  if (revealPending) {
    setAppliedReveal(reveal.revision);
    setFocusedId(reveal.id);
  }
  const revealId = reveal?.id;
  const revealRevision = reveal?.revision;
  useLayoutEffect(() => {
    if (revealId === undefined || revealRevision === undefined) return;
    const rowElement = rowElements.current.get(revealId);
    if (!rowElement) return;
    rowElement.scrollIntoView({ block: 'nearest' });
    if (focusWithin.current) rowElement.focus();
  }, [revealId, revealRevision]);

  useLayoutEffect(() => {
    if (focusWithin.current && !container.current?.contains(document.activeElement)) {
      if (tabStop !== undefined) rowElements.current.get(tabStop)?.focus();
    }
  });

  function focus(row: TreeRow | undefined): void {
    if (row) rowElements.current.get(row.id)?.focus();
  }
  function onKey(event: KeyboardEvent, row: TreeRow, index: number): void {
    switch (event.key) {
      case 'Enter':
      case ' ':
        onActivate(row);
        break;
      case 'ArrowDown':
        focus(rows[Math.min(index + 1, rows.length - 1)]);
        break;
      case 'ArrowUp':
        focus(rows[Math.max(index - 1, 0)]);
        break;
      case 'Home':
        focus(rows[0]);
        break;
      case 'End':
        focus(rows.at(-1));
        break;
      case 'ArrowRight':
        if (row.expanded === false) onActivate(row);
        else if (row.expanded === true) focus(rows[index + 1]);
        break;
      case 'ArrowLeft':
        if (row.expanded === true && row.collapsible !== false) onActivate(row);
        else focus(rows.find((candidate) => candidate.id === row.parentId));
        break;
      default:
        return;
    }
    event.preventDefault();
  }
  const fileCount = (count: number): string => `${count} ${count === 1 ? 'file' : 'files'}`;
  return (
    <div
      ref={container}
      role="tree"
      aria-label={label}
      aria-multiselectable={multiselect}
      onFocus={() => {
        focusWithin.current = true;
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) focusWithin.current = false;
      }}
    >
      {rows.length === 0 ? (
        <p className="p-3 text-caption text-muted-foreground">{emptyMessage}</p>
      ) : (
        rows.map((row, index) => {
          const selected = activation === 'double' ? row.id === tabStop : Boolean(row.selected);
          const rowElement = (
            <div
              key={row.id}
              ref={(element) => {
                if (element) rowElements.current.set(row.id, element);
                else rowElements.current.delete(row.id);
              }}
              role="treeitem"
              data-path={row.path}
              aria-level={row.level}
              aria-label={[
                row.label,
                row.description,
                row.count !== undefined ? fileCount(row.count) : undefined,
                row.status,
                row.ignored ? 'Ignored by Git' : undefined,
                row.analysisExcluded ? 'Excluded from Analysis' : undefined,
              ]
                .filter(Boolean)
                .join(', ')}
              aria-expanded={row.expanded}
              aria-selected={selected}
              tabIndex={row.id === tabStop ? 0 : -1}
              className={`flex h-6 w-full select-none items-center gap-1 whitespace-nowrap rounded-control border-y border-solid border-transparent bg-clip-padding py-0 pr-1 text-left text-caption hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${row.group ? 'mt-1 first:mt-0 font-semibold' : ''} ${selected ? 'bg-accent text-foreground' : row.analysisExcluded ? 'bg-analysis-excluded-surface' : row.ignored ? 'bg-git-ignored-surface' : ''}`}
              title={[
                row.title ?? (row.path || row.label),
                row.ignored ? 'Ignored by Git' : '',
                row.analysisExcluded ? 'Excluded from Analysis' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              style={{ paddingLeft: `calc(var(--spacing) * ${0.5 + (row.level - 1) * 4.5})` }}
              onFocus={() => {
                setFocusedId(row.id);
                onSelect?.(row);
              }}
              onKeyDown={(event) => onKey(event, row, index)}
              onClick={(event) => {
                event.currentTarget.focus();
                // キーボードや支援技術による click はクリック回数が 0 になる。
                if (activation === 'single' || event.detail === 0) onActivate(row);
              }}
              onDoubleClick={() => {
                if (activation === 'double') onActivate(row);
              }}
            >
              {row.expanded !== undefined ? (
                <Button
                  variant="plain"
                  size="content"
                  type="button"
                  tabIndex={-1}
                  aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${row.label}`}
                  disabled={row.collapsible === false}
                  className={`grid size-4 shrink-0 place-items-center text-muted-foreground hover:text-foreground [&_svg]:size-3 [&_svg]:fill-none [&_svg]:stroke-current ${row.expanded ? '[&_svg]:rotate-90' : ''}`}
                  onClick={(event) => {
                    // 矢印は1クリックで開閉する。行へ伝播させると選択やダブルクリックでも再度開閉される。
                    event.stopPropagation();
                    focus(row);
                    if (event.detail <= 1) onActivate(row);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16" strokeWidth={1.6}>
                    <path d="m6 4 4 4-4 4" />
                  </svg>
                </Button>
              ) : (
                <span className="size-4 shrink-0" aria-hidden="true" />
              )}
              {renderControl?.(row)}
              {!row.group &&
                (row.icon ?? <FileIcon path={row.path} folder={row.expanded !== undefined} />)}
              <span
                className={`ml-px truncate ${row.description ? 'max-w-1/2 shrink-0' : ''} ${row.level === 1 || row.group ? 'font-semibold' : 'font-normal'} ${row.analysisExcluded ? 'text-analysis-excluded' : row.ignored ? 'text-git-ignored' : row.status ? statusColor[row.status] : ''}`}
              >
                {row.label}
              </span>
              {row.description && (
                <span className="min-w-0 truncate text-muted-foreground">— {row.description}</span>
              )}
              {row.count !== undefined && (
                <span className="ml-1 shrink-0 text-caption text-muted-foreground">
                  {fileCount(row.count)}
                </span>
              )}
            </div>
          );
          return renderRow ? renderRow(row, rowElement) : rowElement;
        })
      )}
    </div>
  );
}
