import { Link } from 'lucide-react';
import { isExcludedPath } from '../../../shared/explorer-settings.ts';
import type { GitEntry, GitKind } from '../../../shared/protocol.ts';
import { type TreeRow, TreeView } from '../../components/tree-view';
import { renderReact } from '../../lib/react-view';
import { type ExplorerAction, ExplorerMenu } from './explorer-menu';

type TreeNode = { path: string; name: string; children: Map<string, TreeNode>; file: boolean };

/** プロジェクトのファイルツリー。表示名とパスを分けて持つので、同名のファイルも区別できる。 */
export class FileTree {
  private readonly element: HTMLElement;
  private readonly onExpand: (recursive?: string) => void;
  private readonly onOpen: (path: string) => void;
  private files: string[] = [];
  private directories: string[] = [];
  private ignoredPaths = new Set<string>();
  private analysisExcludedPaths: string[] = [];
  private active = '';
  private selectedFolder?: string;
  private filter = '';
  private searchTimer?: ReturnType<typeof setTimeout>;
  private expandBelow?: string;
  get searching(): boolean {
    return !!this.filter;
  }
  private symlinks = new Map<string, string>();
  get expandedPaths(): string[] {
    return [...this.expanded];
  }
  private expanded = new Set<string>(['', 'src']);
  private projectName = '';
  private readonly statuses = new Map<string, GitKind>();
  private revealRevision = 0;
  private projectRoot = '';
  private canPaste = false;
  private readonly onAction: (action: ExplorerAction, path: string, directory: boolean) => void;
  private readonly onAnalysisChange: (path: string, directory: boolean, include: boolean) => void;

  /**
   * @param onAnalysisChange 解析の除外を切り替える。include が true なら今は除外されているので含める
   * @param onAction 右クリックメニューの操作
   */
  constructor(
    element: HTMLElement,
    onOpen: (path: string) => void,
    onAnalysisChange: (path: string, directory: boolean, include: boolean) => void,
    onAction: (action: ExplorerAction, path: string, directory: boolean) => void,
    onExpand: (recursive?: string) => void,
  ) {
    this.onExpand = onExpand;
    this.onAnalysisChange = onAnalysisChange;
    this.onAction = onAction;
    this.element = element;
    this.onOpen = onOpen;
  }

  setFiles(
    files: string[],
    directories: string[],
    analysisExcludedPaths: string[],
    symlinks: Record<string, string>,
  ): void {
    this.symlinks = new Map(Object.entries(symlinks));
    this.analysisExcludedPaths = analysisExcludedPaths;
    this.files = files;
    this.directories = directories;
    if (this.expandBelow !== undefined) {
      for (const folder of directories)
        if (
          !this.expandBelow ||
          folder === this.expandBelow ||
          folder.startsWith(`${this.expandBelow}/`)
        )
          this.expanded.add(folder);
      this.expandBelow = undefined;
    }
    this.render();
  }
  setProject(name: string, root: string): void {
    if (root !== this.projectRoot) {
      this.selectedFolder = undefined;
      this.expanded = new Set(['', 'src']);
    }
    this.projectName = name;
    this.projectRoot = root;
  }
  setClipboard(available: boolean): void {
    this.canPaste = available;
    this.render();
  }
  /** Git の状態でファイル名を色分けする。未追跡のファイルしか含まないフォルダは未追跡、それ以外の変更を含むフォルダは変更ありとして扱う。 */
  setStatuses(entries: Pick<GitEntry, 'path' | 'kind'>[], ignoredPaths: string[] = []): void {
    this.ignoredPaths = new Set(ignoredPaths);
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
    this.expandBelow = selected;
    this.onExpand(selected);
    this.render();
  }

  collapseAll(): void {
    this.expanded = new Set(['']);
    this.render();
  }
  search(query: string): void {
    const previous = this.filter;
    this.filter = query.trim().toLowerCase();
    clearTimeout(this.searchTimer);
    if (this.filter && this.filter !== previous)
      this.searchTimer = setTimeout(() => this.onExpand(''), 250);
    this.render();
  }
  reveal(path: string): void {
    this.active = path;
    this.expanded.add('');
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) this.expanded.add(parts.slice(0, i).join('/'));
    this.revealRevision++;
    this.render();
    // 空パスは選択解除。プロジェクト未選択時に読み込み要求を送らない。
    if (path && !this.files.includes(path)) this.onExpand();
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
          icon: this.symlinks.get(node.path) ? <Link size={16} /> : undefined,
          title: this.symlinks.get(node.path)
            ? `${node.path} → ${this.symlinks.get(node.path)}`
            : undefined,
          level,
          expanded: node.file ? undefined : expanded,
          status: this.statuses.get(node.path),
          ignored: this.ignoredPaths.has(node.path),
          analysisExcluded:
            !!node.path && isExcludedPath(node.path, !node.file, this.analysisExcludedPaths),
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
        renderRow={(row, button) => (
          <ExplorerMenu
            key={row.id}
            path={row.path}
            root={this.projectRoot}
            directory={row.expanded !== undefined}
            excluded={isExcludedPath(
              row.path,
              row.expanded !== undefined,
              this.analysisExcludedPaths,
            )}
            canPaste={this.canPaste}
            onAction={(action) => this.onAction(action, row.path, row.expanded !== undefined)}
            onAnalysisChange={() =>
              this.onAnalysisChange(
                row.path,
                row.expanded !== undefined,
                isExcludedPath(row.path, row.expanded !== undefined, this.analysisExcludedPaths),
              )
            }
          >
            {button}
          </ExplorerMenu>
        )}
        onSelect={(row) => {
          this.selectedFolder = row.expanded === undefined ? undefined : row.path;
        }}
        onActivate={(row) => {
          if (row.expanded === undefined) this.onOpen(row.path);
          else if (!this.filter) {
            if (this.expanded.has(row.path)) this.expanded.delete(row.path);
            else {
              this.expanded.add(row.path);
              this.onExpand();
            }
            this.render();
          }
        }}
      />,
    );
  }
}
