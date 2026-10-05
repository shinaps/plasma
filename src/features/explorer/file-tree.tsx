import type { GitEntry, GitKind } from '../../../shared/protocol.ts';
import { type TreeRow, TreeView } from '../../components/tree-view';
import { renderReact } from '../../lib/react-view';

type TreeNode = { path: string; name: string; children: Map<string, TreeNode>; file: boolean };

/** プロジェクトのファイルツリー。表示名とパスを分けて持つので、同名のファイルも区別できる。 */
export class FileTree {
  private readonly element: HTMLElement;
  private readonly onOpen: (path: string) => void;
  private files: string[] = [];
  private directories: string[] = [];
  private active = '';
  private selectedFolder?: string;
  private filter = '';
  private expanded = new Set<string>(['', 'src']);
  private projectName = '';
  private readonly statuses = new Map<string, GitKind>();
  private revealRevision = 0;

  constructor(element: HTMLElement, onOpen: (path: string) => void) {
    this.element = element;
    this.onOpen = onOpen;
  }

  setFiles(files: string[], directories: string[] = []): void {
    this.files = files;
    this.directories = directories;
    this.render();
  }
  setProject(name: string): void {
    this.projectName = name;
    this.selectedFolder = undefined;
  }
  /** Git の状態でファイル名を色分けする。未追跡のファイルしか含まないフォルダは未追跡、それ以外の変更を含むフォルダは変更ありとして扱う。 */
  setStatuses(entries: Pick<GitEntry, 'path' | 'kind'>[]): void {
    this.statuses.clear();
    for (const entry of entries) {
      this.statuses.set(entry.path, entry.kind);
      const parts = entry.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const folder = parts.slice(0, i).join('/');
        if (entry.kind !== 'untracked' || this.statuses.get(folder) === undefined)
          this.statuses.set(folder, entry.kind === 'untracked' ? 'untracked' : 'modified');
      }
    }
    this.render();
  }
  expandSelected(): void {
    const selected = this.selectedFolder;
    if (selected === undefined) return;
    this.expanded.add(selected);
    const directories = new Set(this.directories);
    for (const path of [...this.directories, ...this.files]) {
      const parts = path.split('/');
      const length = directories.has(path) ? parts.length : parts.length - 1;
      for (let i = 1; i <= length; i++) {
        const folder = parts.slice(0, i).join('/');
        if (!selected || folder === selected || folder.startsWith(`${selected}/`))
          this.expanded.add(folder);
      }
    }
    this.render();
  }
  collapseAll(): void {
    this.expanded = new Set(['']);
    this.render();
  }
  search(query: string): void {
    this.filter = query.trim().toLowerCase();
    this.render();
  }
  reveal(path: string): void {
    this.active = path;
    this.expanded.add('');
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) this.expanded.add(parts.slice(0, i).join('/'));
    this.revealRevision++;
    this.render();
  }

  private render(): void {
    const root: TreeNode = { path: '', name: this.projectName, children: new Map(), file: false };
    const directories = new Set(this.directories);
    for (const path of [...this.directories, ...this.files].filter((file) =>
      file.toLowerCase().includes(this.filter),
    )) {
      let parent = root;
      path.split('/').forEach((name, index, parts) => {
        let node = parent.children.get(name);
        if (!node) {
          node = {
            path: parts.slice(0, index + 1).join('/'),
            name,
            children: new Map(),
            file: index === parts.length - 1 && !directories.has(path),
          };
          parent.children.set(name, node);
        }
        parent = node;
      });
    }
    const rows: TreeRow[] = [];
    const visit = (parent: TreeNode, level: number): void => {
      const children = [...parent.children.values()].sort(
        (left, right) =>
          Number(left.file) - Number(right.file) || left.name.localeCompare(right.name),
      );
      for (const node of children) {
        const expanded = !!this.filter || this.expanded.has(node.path);
        rows.push({
          id: node.path,
          parentId: parent.path,
          path: node.path,
          label: node.name,
          level,
          expanded: node.file ? undefined : expanded,
          status: this.statuses.get(node.path),
          selected: !!this.active && node.path === this.active,
          collapsible: !this.filter,
        });
        if (!node.file && expanded) visit(node, level + 1);
      }
    };
    if (this.projectName && !this.filter)
      visit({ path: '', name: '', file: false, children: new Map([['root', root]]) }, 1);
    else visit(root, 1);
    renderReact(
      this.element,
      <TreeView
        key={this.projectName}
        label="Files"
        rows={rows}
        emptyMessage="No matching files"
        reveal={this.active ? { id: this.active, revision: this.revealRevision } : undefined}
        onSelect={(row) => {
          this.selectedFolder = row.expanded === undefined ? undefined : row.path;
        }}
        onActivate={(row) => {
          if (row.expanded === undefined) this.onOpen(row.path);
          else if (!this.filter) {
            if (this.expanded.has(row.path)) this.expanded.delete(row.path);
            else this.expanded.add(row.path);
            this.render();
          }
        }}
      />,
    );
  }
}
