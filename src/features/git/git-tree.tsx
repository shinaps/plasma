import type { GitEntry, GitKind } from '../../../shared/protocol.ts';
import { type TreeRow, TreeView } from '../../components/tree-view';
import { renderReact } from '../../lib/react-view';

type Node = {
  key: string;
  name: string;
  path: string;
  count: number;
  children: Map<string, Node>;
  entry?: GitEntry;
};
// 種類ごとにどのグループに入れるか。種類が増えたら必ずここで決める。
const groupOfKind = {
  modified: 'Changes',
  added: 'Changes',
  deleted: 'Changes',
  conflict: 'Changes',
  untracked: 'Unversioned Files',
} satisfies Record<GitKind, 'Changes' | 'Unversioned Files'>;

/**
 * 変更ファイルを「Changes」と「Unversioned Files」に分けた階層ツリー。
 * 子が 1 つだけのフォルダはパスをまとめて表示し、ファイル名のための幅を残す。
 */
export class GitTree {
  private readonly element: HTMLElement;
  private readonly open: (path: string) => void;
  private readonly collapsed = new Set<string>();
  private projectRevision = 0;
  private readonly seen = new Set<string>();
  private selected = '';
  private selectedFolder?: string;
  private available = false;
  private rows: TreeRow[] = [];
  constructor(element: HTMLElement, open: (path: string) => void) {
    this.element = element;
    this.open = open;
  }
  reset(): void {
    this.selectedFolder = undefined;
    this.collapsed.clear();
    this.seen.clear();
    this.projectRevision++;
    this.selected = '';
    this.rows = [];
  }
  expandSelected(): void {
    const selected = this.selectedFolder;
    if (selected === undefined) return;
    for (const row of this.rows)
      if (row.id === selected || row.id.startsWith(`${selected}/`)) this.collapsed.delete(row.id);
    this.render();
  }
  setAllExpanded(expanded: boolean): void {
    for (const row of this.rows) {
      if (row.expanded === undefined) continue;
      if (expanded) this.collapsed.delete(row.id);
      else this.collapsed.add(row.id);
    }
    this.render();
  }
  update(entries: GitEntry[], selected: string, available: boolean): void {
    const groups = ['Changes', 'Unversioned Files'].map((name) => ({
      key: name,
      name,
      path: '',
      count: 0,
      children: new Map<string, Node>(),
    }));
    let selectedKey = '';
    for (const entry of entries) {
      const group = groups[groupOfKind[entry.kind] === 'Changes' ? 0 : 1];
      let parent = group;
      parent.count++;
      entry.path.split('/').forEach((name, index, parts) => {
        const path = parts.slice(0, index + 1).join('/');
        let node = parent.children.get(name);
        if (!node) {
          node = {
            key: `${group.key}/${path}`,
            name,
            path,
            count: 0,
            children: new Map(),
          };
          parent.children.set(name, node);
        }
        node.count++;
        if (index === parts.length - 1) {
          node.entry = entry;
          if (entry.path === selected) selectedKey = node.key;
        }
        parent = node;
      });
    }
    const rows: TreeRow[] = [];
    const visit = (original: Node, level: number, parentKey = '', group = false): void => {
      let node = original;
      let name = node.name;
      while (!group && !node.entry && node.children.size === 1) {
        const child = [...node.children.values()][0];
        if (child.entry) break;
        name += `/${child.name}`;
        node = child;
      }
      if (!this.seen.has(node.key)) {
        this.seen.add(node.key);
        // 最初は浅い階層だけを開く。深いフォルダは操作か「現在ファイルの表示」で開く。
        if (!node.entry && level >= 3) this.collapsed.add(node.key);
      }
      if (selected !== this.selected && selected && selectedKey.startsWith(`${node.key}/`))
        this.collapsed.delete(node.key);
      const expanded = !this.collapsed.has(node.key);
      rows.push({
        id: node.key,
        parentId: parentKey,
        path: node.path,
        label: name,
        title: node.entry?.oldPath
          ? `${node.path} (renamed from ${node.entry.oldPath})`
          : undefined,
        level,
        group,
        expanded: node.entry ? undefined : expanded,
        selected: node.entry?.path === selected,
        status: node.entry?.kind,
        count: node.entry ? undefined : node.count,
      });
      if (!node.entry)
        [...node.children.values()]
          .sort(
            (left, right) =>
              Number(!!left.entry) - Number(!!right.entry) || left.name.localeCompare(right.name),
          )
          .forEach((child) => {
            visit(child, level + 1, node.key);
          });
    };
    for (const group of groups.filter((candidate) => candidate.count)) visit(group, 1, '', true);
    this.selected = selected;
    this.available = available;
    this.rows = rows;
    this.render();
  }
  private render(): void {
    const hidden = new Set<string>();
    const rows = this.rows.flatMap((row) => {
      const invisible = !!row.parentId && hidden.has(row.parentId);
      const expanded = row.expanded === undefined ? undefined : !this.collapsed.has(row.id);
      if (invisible || expanded === false) hidden.add(row.id);
      return invisible ? [] : [{ ...row, expanded }];
    });
    renderReact(
      this.element,
      <TreeView
        key={this.projectRevision}
        label="Changed files"
        rows={rows}
        emptyMessage={this.available ? 'No changes' : 'Not a Git repository'}
        onSelect={(row) => {
          this.selectedFolder = row.expanded === undefined ? undefined : row.id;
        }}
        onActivate={(row) => {
          if (row.expanded === undefined) this.open(row.path);
          else {
            if (row.expanded) this.collapsed.add(row.id);
            else this.collapsed.delete(row.id);
            this.render();
          }
        }}
      />,
    );
  }
}
