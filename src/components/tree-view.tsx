import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { GitKind } from '../../shared/protocol.ts';
import { FileIcon } from './icons';

export type TreeRow = {
  id: string;
  parentId?: string;
  path: string;
  label: string;
  level: number;
  /** フォルダなら開閉の状態。ファイルなら undefined */
  expanded?: boolean;
  /** false なら左矢印で閉じない (検索中など、開閉を利用者に任せない表示) */
  collapsible?: boolean;
  /** 「Changes」のような見出し行。アイコンを持たず、太字で間隔を空けて表示する */
  group?: boolean;
  status?: GitKind;
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
  rows: TreeRow[];
  emptyMessage: string;
  /** 表示してフォーカスを移す行。同じ id をもう一度表示し直すときは revision を進める */
  reveal?: { id: string; revision: number };
  /** クリックか Enter で呼ぶ。フォルダなら開閉、ファイルなら開く */
  onActivate: (row: TreeRow) => void;
  /** 行にフォーカスが移ったときに呼ぶ。「選択中のフォルダを展開」の対象を知らせる */
  onSelect?: (row: TreeRow) => void;
};

/** 行の表示・キーボード操作・フォーカスを担当する。どの行を表示するかと開閉の状態は呼び出し側が決める。 */
export function TreeView({
  label,
  multiselect,
  rows,
  emptyMessage,
  reveal,
  onActivate,
  onSelect,
}: Props): ReactNode {
  const [focusedId, setFocusedId] = useState<string>();
  const [appliedReveal, setAppliedReveal] = useState<number>();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
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
    const button = buttons.current.get(revealId);
    if (!button) return;
    button.scrollIntoView({ block: 'nearest' });
    if (focusWithin.current) button.focus();
  }, [revealId, revealRevision]);

  useLayoutEffect(() => {
    if (focusWithin.current && !container.current?.contains(document.activeElement)) {
      if (tabStop !== undefined) buttons.current.get(tabStop)?.focus();
    }
  });

  function focus(row: TreeRow | undefined): void {
    if (row) buttons.current.get(row.id)?.focus();
  }
  function onKey(event: KeyboardEvent, row: TreeRow, index: number): void {
    switch (event.key) {
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
        rows.map((row, index) => (
          <button
            type="button"
            key={row.id}
            ref={(button) => {
              if (button) buttons.current.set(row.id, button);
              else buttons.current.delete(row.id);
            }}
            role="treeitem"
            aria-level={row.level}
            aria-label={[
              row.label,
              row.count !== undefined ? fileCount(row.count) : undefined,
              row.status,
            ]
              .filter(Boolean)
              .join(', ')}
            aria-expanded={row.expanded}
            aria-selected={Boolean(row.selected)}
            tabIndex={row.id === tabStop ? 0 : -1}
            className={`flex h-8 w-full items-center gap-1 whitespace-nowrap rounded-control border-y-2 border-solid border-transparent bg-clip-padding py-0 pr-1 text-left text-caption hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${row.group ? 'mt-2 first:mt-0 font-semibold' : ''} ${row.selected ? 'bg-accent text-foreground' : ''}`}
            title={row.title ?? (row.path || row.label)}
            style={
              {
                paddingLeft: `calc(var(--spacing) * ${0.5 + (row.level - 1) * 4.5})`,
              } as CSSProperties
            }
            onFocus={() => {
              setFocusedId(row.id);
              onSelect?.(row);
            }}
            onKeyDown={(event) => onKey(event, row, index)}
            onClick={() => onActivate(row)}
          >
            <span
              className={`grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3 [&_svg]:fill-none [&_svg]:stroke-current ${row.expanded ? '[&_svg]:rotate-90' : ''}`}
              aria-hidden="true"
            >
              {row.expanded !== undefined && (
                <svg aria-hidden="true" viewBox="0 0 16 16" strokeWidth={1.6}>
                  <path d="m6 4 4 4-4 4" />
                </svg>
              )}
            </span>
            {!row.group &&
              (row.icon ?? <FileIcon path={row.path} folder={row.expanded !== undefined} />)}
            <span
              className={`ml-px truncate ${row.level === 1 || row.group ? 'font-semibold' : 'font-normal'} ${row.status ? statusColor[row.status] : ''}`}
            >
              {row.label}
            </span>
            {row.count !== undefined && (
              <span className="ml-1 shrink-0 text-caption text-muted-foreground">
                {fileCount(row.count)}
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
