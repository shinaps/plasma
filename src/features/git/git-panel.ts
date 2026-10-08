import * as monaco from 'monaco-editor/editor/editor.api';
import { createElement } from 'react';
import { errorMessage } from '../../../shared/errors.ts';
import {
  type DiffView,
  emptyGitStatus,
  type GitStatus,
  type PartialSelection,
  type PullRequestComparison,
  type SendRequest,
} from '../../../shared/protocol.ts';
import { buttonHtml } from '../../components/ui/button';
import { setTogglePressed, toggleHtml } from '../../components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { requireElement } from '../../lib/dom';
import { icon } from '../../lib/icons';
import { renderReact } from '../../lib/react-view';
import { rendererTheme } from '../../styles/renderer-theme';
import type { Annotations } from '../editor/annotations';
import { CommitForm } from './commit-form';
import { decorateDiff } from './diff-decoration';
import { GitTree } from './git-tree';
import { renderImageDiff } from './image-diff';
import { NaturalDiff } from './natural-diff';
import { PullRequests } from './pull-requests';

export type GitPanelOptions = {
  /** 変更一覧を描く要素 */
  panel: HTMLElement;
  /** 差分表示を描く要素 */
  view: HTMLElement;
  request: SendRequest;
  /** パスから Monaco の言語 ID を決める */
  language: (path: string) => string;
  /** 差分を開いたときに呼ぶ。メイン画面を差分表示に切り替える */
  onDiff: () => void;
  /** 差分を閉じたときに呼ぶ */
  onClose: () => void;
  report: (message: string) => void;
  annotations: Annotations;
  root: () => string;
  /** 作業ツリー側のモデルを DocumentStore から受け取る。差分の右側を編集できるようにするため。破棄は DocumentStore が行う */
  loadWorkingModel: (path: string) => Promise<monaco.editor.ITextModel>;
  openFile: (path: string, position?: monaco.IPosition) => Promise<void>;
  save: () => Promise<void>;
  hasUnsaved: (paths: string[]) => boolean;
  onCommitted: () => Promise<void>;
};

/** Git の変更一覧と左右比較。作業ツリーと HEAD や index の比較に加えて、履歴で選んだコミットとその親の比較も表示する。 */
export class GitPanel {
  private readonly options: GitPanelOptions;
  private readonly view: HTMLElement;
  private state: GitStatus = emptyGitStatus();
  private selected = '';
  private commit?: string | PullRequestComparison;
  private prMode = false;
  private prComparison?: PullRequestComparison;
  private readonly prTree: GitTree;
  private generation = 0;
  private diff?: NaturalDiff;
  private addedEditor?: monaco.editor.IStandaloneCodeEditor;
  private diffSubscription?: monaco.IDisposable;
  private diffDecoration?: monaco.IDisposable;
  private navigationReady = false;
  private navigating = false;
  private comparisonPaths: string[] = [];
  private wrapPreference?: boolean;
  private models: monaco.editor.ITextModel[] = [];
  private readonly tree: GitTree;
  private commitFormRevision = 0;
  private checkedPaths: string[] = [];
  private partial = new Map<string, PartialSelection>();
  private previewMode = false;
  private identical = false;
  private previewUpdate?: () => void;
  /** 開いている差分に付けた、内容の監視と装飾。差分を閉じるときにまとめて解除する。 */
  private contentSubscription?: monaco.IDisposable;
  constructor(options: GitPanelOptions) {
    this.options = options;
    this.view = options.view;
    options.panel.innerHTML =
      '<div class="git-modes px-2 pb-2"></div><div class="pr-picker" hidden></div><div class="pr-files flex-1 overflow-auto px-1.5 pb-2.5" hidden></div><div class="change-list flex-1 overflow-auto px-1.5 pb-2.5"></div><div class="commit-form"></div>';
    this.prTree = new GitTree(requireElement('.pr-files', options.panel), (path) => {
      if (this.prComparison)
        void this.open(path, this.prComparison).catch((error) =>
          options.report(errorMessage(error)),
        );
    });
    this.renderModes();
    this.tree = new GitTree(
      requireElement('.change-list', options.panel),
      (path) => void this.open(path).catch((error) => options.report(errorMessage(error))),
      (paths, changed) => {
        for (const path of changed ?? []) this.partial.delete(path);
        // 一覧から消えたファイルの行選択は捨てる。残すと存在しないパスを送り、以後のコミットがすべて失敗する。
        for (const path of this.partial.keys()) if (!this.hasEntry(path)) this.partial.delete(path);
        this.checkedPaths = paths;
        this.tree.partialPaths = new Set(this.partial.keys());
        const included = [...new Set([...paths, ...this.partial.keys()])];
        this.diff?.refreshControls();
        renderReact(
          requireElement('.commit-form', options.panel),
          createElement(CommitForm, {
            key: this.commitFormRevision,
            paths: included,
            commit: async (message) => {
              if (options.hasUnsaved(included))
                throw new Error(
                  'Save or discard unsaved edits in the checked files before committing.',
                );
              const { hash } = await options.request({
                op: 'git-commit-files',
                paths: included,
                message,
                partial: [...this.partial.values()],
              });
              this.partial.clear();
              try {
                await options.onCommitted();
              } catch (error) {
                options.report(
                  `Commit succeeded, but refreshing changes failed: ${errorMessage(error)}`,
                );
              }
              return `Committed ${hash.slice(0, 8)}`;
            },
          }),
        );
      },
    );
    this.view.innerHTML = `<div class="diff-toolbar flex min-h-10 shrink-0 items-center gap-1.5 px-3 [&_strong]:flex-1 [&_strong]:truncate [&_strong]:text-caption [&_strong]:font-medium [&_button]:size-7 [&_button]:rounded-control [&_button]:text-body">${buttonHtml({ className: '', attributes: { id: 'previous-file', title: 'Previous File', 'aria-label': 'Previous File' } }, '←')}<span id="file-position" class="text-caption whitespace-nowrap"></span>${buttonHtml({ className: '', attributes: { id: 'next-file', title: 'Next File', 'aria-label': 'Next File' } }, '→')}<strong id="diff-path"></strong><span id="change-position" class="text-caption text-muted-foreground whitespace-nowrap"></span>${toggleHtml({ id: 'diff-preview', hidden: true, title: 'Image Preview', 'aria-label': 'Image Preview', 'aria-pressed': 'false' })}${buttonHtml({ className: 'inline-grid place-items-center', attributes: { id: 'diff-open', 'aria-label': 'Open Working File', title: 'Open Working File' } }, '')}${toggleHtml({ id: 'diff-wrap', 'aria-label': 'Word Wrap', 'aria-pressed': 'false', title: 'Wrap text on both sides' })}${buttonHtml({ className: '', attributes: { id: 'previous-change', title: 'Previous Change', 'aria-label': 'Previous Change' } }, '↑')}${buttonHtml({ className: '', attributes: { id: 'next-change', title: 'Next Change', 'aria-label': 'Next Change' } }, '↓')}${buttonHtml({ className: '', attributes: { id: 'close-diff', 'aria-label': 'Close Diff', title: 'Close Diff' } }, '×')}</div><div id="diff-identical" role="status" class="shrink-0 bg-muted px-3 py-1 text-caption text-muted-foreground" hidden>Contents are identical</div><div class="diff-labels"><div><span class="diff-revision"></span><span class="diff-path"></span></div><div><span class="diff-revision"></span><span class="diff-path"></span></div></div><div class="diff-images min-h-0 flex-1" hidden></div><div class="diff-editor min-h-0 flex-1"></div><div class="added-editor min-h-0 flex-1" hidden></div>`;
    requireElement<HTMLButtonElement>('#diff-open', this.view).onclick = () => {
      const position =
        this.commit || this.previewMode
          ? undefined
          : (this.activeEditor()?.getPosition() ?? undefined);
      void options
        .openFile(this.selected, position)
        .catch((error) => options.report(errorMessage(error)));
    };
    requireElement('#diff-preview', this.view).append(icon('preview'));
    requireElement<HTMLButtonElement>('#diff-preview', this.view).onclick = () => {
      this.previewMode = !this.previewMode;
      this.previewUpdate?.();
    };
    requireElement('#diff-open', this.view).append(icon('open-file'));
    requireElement('#diff-wrap', this.view).append(icon('wrap'));
    requireElement<HTMLButtonElement>('#diff-wrap', this.view).onclick = () => {
      this.wrapPreference =
        requireElement('#diff-wrap', this.view).getAttribute('aria-pressed') !== 'true';
      this.applyWrapping();
    };
    for (const [id, direction] of [
      ['previous-file', -1],
      ['next-file', 1],
    ] as const) {
      requireElement<HTMLButtonElement>(`#${id}`, this.view).onclick = () => {
        void this.navigateFile(direction).catch((error) => options.report(errorMessage(error)));
      };
    }
    requireElement<HTMLButtonElement>('#close-diff', this.view).onclick = () => this.close();
    for (const [id, direction] of [
      ['previous-change', -1],
      ['next-change', 1],
    ] as const)
      requireElement<HTMLButtonElement>(`#${id}`, this.view).onclick = () => {
        void this.navigateChange(direction).catch((error) => options.report(errorMessage(error)));
      };
  }
  private renderModes(): void {
    const panel = this.options.panel;
    renderReact(
      requireElement('.git-modes', panel),
      createElement(
        ToggleGroup,
        {
          type: 'single',
          value: this.prMode ? 'prs' : 'changes',
          'aria-label': 'Git view',
          onValueChange: (value: string) => {
            if (!value) return;
            this.close();
            this.prMode = value === 'prs';
            this.prComparison = undefined;
            this.prTree.reset();
            this.renderModes();
          },
        },
        createElement(
          ToggleGroupItem,
          { value: 'changes', className: 'w-auto flex-1 px-2 whitespace-nowrap text-caption' },
          'Changes',
        ),
        createElement(
          ToggleGroupItem,
          { value: 'prs', className: 'w-auto flex-1 px-2 whitespace-nowrap text-caption' },
          'Pull Requests',
        ),
      ),
    );
    for (const name of ['change-list', 'commit-form'])
      requireElement<HTMLElement>(`.${name}`, panel).hidden = this.prMode;
    for (const name of ['pr-picker', 'pr-files'])
      requireElement<HTMLElement>(`.${name}`, panel).hidden = !this.prMode;
    renderReact(
      requireElement('.pr-picker', panel),
      this.prMode
        ? createElement(PullRequests, {
            request: this.options.request,
            onSelect: (comparison?: PullRequestComparison) => {
              this.close();
              this.prComparison = comparison;
              this.prTree.update(comparison?.entries ?? [], '', true);
              const first = comparison?.entries[0];
              if (first)
                void this.open(first.path, comparison).catch((error) =>
                  this.options.report(errorMessage(error)),
                );
            },
          })
        : null,
    );
  }
  private updateNavigation(): void {
    const paths = this.commit ? this.comparisonPaths : this.tree.filePaths;
    const index = paths.indexOf(this.selected);
    requireElement('#file-position', this.view).textContent =
      index < 0 ? '' : `${index + 1}/${paths.length} files`;
    const lines = this.changeLines();
    const current = this.activeEditor()?.getPosition()?.lineNumber ?? 1;
    const position = lines.filter((line) => line <= current).length;
    const failed =
      !this.previewMode && !this.addedEditor?.getModel() && this.diff?.hasFailed() === true;
    requireElement('#change-position', this.view).textContent = !this.navigationReady
      ? 'Calculating…'
      : failed
        ? 'Diff unavailable'
        : `${position}/${lines.length} differences${this.commit ? ' · Read only' : `, ${this.partial.get(this.selected)?.changes.length ?? (this.checkedPaths.includes(this.selected) ? lines.length : 0)} included`}`;
    requireElement<HTMLButtonElement>('#previous-file', this.view).disabled = index <= 0;
    requireElement<HTMLButtonElement>('#next-file', this.view).disabled =
      index < 0 || index >= paths.length - 1;
  }
  private async navigateFile(direction: -1 | 1): Promise<void> {
    if (this.navigating) return;
    const paths = this.commit ? this.comparisonPaths : this.tree.filePaths;
    const path = paths[paths.indexOf(this.selected) + direction];
    if (!path) return;
    this.navigating = true;
    try {
      await this.open(path, this.commit, direction === 1 ? 'first' : 'last');
    } finally {
      this.navigating = false;
    }
  }
  private changeLines(): number[] {
    if (this.previewMode) return this.identical ? [] : [1];
    if (this.addedEditor?.getModel()) return [1];
    const lastLine = this.diff?.getModifiedEditor().getModel()?.getLineCount() ?? 1;
    return [
      ...new Set(
        (this.diff?.getLineChanges() ?? []).map((change) =>
          Math.min(
            lastLine,
            Math.max(
              1,
              change.modifiedStartLineNumber + (change.modifiedEndLineNumber === 0 ? 1 : 0),
            ),
          ),
        ),
      ),
    ];
  }
  private revealChange(line: number): void {
    const editor = this.activeEditor();
    if (!editor || this.previewMode) return;
    const target = Math.min(line, editor.getModel()?.getLineCount() ?? 1);
    editor.setPosition({ lineNumber: target, column: 1 });
    editor.revealLineInCenter(target);
    editor.focus();
  }
  private async navigateChange(direction: -1 | 1): Promise<void> {
    if (!this.navigationReady || this.navigating) return;
    const lines = this.changeLines();
    const current = this.activeEditor()?.getPosition()?.lineNumber ?? 1;
    const next =
      direction === 1
        ? lines.find((line) => line > current)
        : [...lines].reverse().find((line) => line < current);
    if (next !== undefined && !this.previewMode) {
      this.revealChange(next);
      return;
    }
    await this.navigateFile(direction);
  }

  private activeEditor(): monaco.editor.IStandaloneCodeEditor | undefined {
    return this.addedEditor?.getModel() ? this.addedEditor : this.diff?.getModifiedEditor();
  }
  private bindEditor(editor: monaco.editor.IStandaloneCodeEditor): void {
    editor.onDidChangeCursorPosition(() => this.updateNavigation());
    editor.addAction({
      id: 'workbench.save',
      label: 'Save All',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => this.options.save().catch((error) => this.options.report(errorMessage(error))),
    });
    this.options.annotations.bind(editor, () =>
      this.view.hidden || typeof this.commit === 'string' || this.activeEditor() !== editor
        ? undefined
        : {
            root:
              typeof this.commit === 'object' ? this.commit.repositoryRoot : this.options.root(),
            path: this.selected,
            ...(typeof this.commit === 'object'
              ? {
                  pullRequest: {
                    number: this.commit.number,
                    url: this.commit.url,
                    baseCommit: this.commit.baseCommit,
                    headCommit: this.commit.headCommit,
                  },
                }
              : {}),
          },
    );
  }
  private applyWrapping(): void {
    // 長い文章は折り返した方が読める。明示した選択はその後の比較にも使う。
    const wrap = this.wrapPreference ?? this.options.language(this.selected) === 'markdown';
    this.diff?.updateOptions({ diffWordWrap: wrap ? 'on' : 'off' });
    this.addedEditor?.updateOptions({ wordWrap: wrap ? 'on' : 'off' });
    setTogglePressed(requireElement('#diff-wrap', this.view), wrap);
  }
  updateFontSize(): void {
    const theme = rendererTheme();
    this.addedEditor?.updateOptions({
      fontSize: theme.editorFontSize,
      lineHeight: theme.editorLineHeight,
    });
    this.diff?.updateOptions({
      fontSize: theme.editorFontSize,
      lineHeight: theme.editorLineHeight,
    });
  }
  update(state: GitStatus): void {
    this.state = state;
    // 一覧から消えたファイルの作業ツリー差分は閉じる。一覧と差分表示をいつも一致させる。
    if (this.selected && !this.commit && !this.hasEntry(this.selected)) this.close();
    this.render();
  }
  private hasEntry(path: string): boolean {
    return this.state.entries.some((entry) => entry.path === path);
  }
  /** 履歴を閉じるときに呼ぶ。コミットの差分だけを閉じる。 */
  releaseCommit(): void {
    if (typeof this.commit === 'string') this.close();
  }
  reset(): void {
    this.partial.clear();
    this.checkedPaths = [];
    this.commitFormRevision++;
    this.close();
    this.tree.reset();
    this.prMode = false;
    this.prComparison = undefined;
    this.prTree.reset();
    this.renderModes();
    this.state = emptyGitStatus();
    this.render();
  }
  expandSelected(): void {
    (this.prMode ? this.prTree : this.tree).expandSelected();
  }
  collapseAll(): void {
    (this.prMode ? this.prTree : this.tree).setAllExpanded(false);
  }
  /** 文書を閉じるときに呼ぶ。その文書を作業ツリー側に表示している差分だけを閉じる。 */
  release(path: string): void {
    if (this.selected === path && !this.commit) this.close();
  }
  async refreshSelection(): Promise<void> {
    if (!this.selected) return;
    if (this.commit || this.hasEntry(this.selected))
      await this.open(this.selected, this.commit, null);
    else this.close();
  }
  private render(): void {
    this.prTree.update(
      this.prComparison?.entries ?? [],
      typeof this.commit === 'object' ? this.selected : '',
      true,
    );
    this.tree.update(this.state.entries, this.commit ? '' : this.selected, this.state.available);
    this.updateNavigation();
  }

  /**
   * 差分を開く。
   * @param path 変更一覧にあるプロジェクト相対パス
   * @param commit 比較するコミット。省略すると作業ツリーと HEAD を比べる
   * @param edge 開いた後に移動する変更。null なら今の表示位置とフォーカスを保って開き直す (再取得用)
   */
  async open(
    path: string,
    commit?: string | PullRequestComparison,
    edge: 'first' | 'last' | null = 'first',
  ): Promise<void> {
    if (this.prMode && typeof commit !== 'object') {
      this.prMode = false;
      this.prComparison = undefined;
      this.renderModes();
    }
    const generation = ++this.generation;
    const result: DiffView =
      typeof commit === 'object'
        ? await this.options.request({ op: 'git-pr-diff', path, id: commit.id })
        : commit
          ? await this.options.request({ op: 'git-commit-diff', path, ref: commit })
          : await this.options.request({ op: 'git-diff', path });
    if (generation !== this.generation) return;
    const workingModel = result.editable ? await this.options.loadWorkingModel(path) : undefined;
    if (generation !== this.generation) return;
    this.navigationReady = false;
    this.diffSubscription?.dispose();
    this.diffDecoration?.dispose();
    this.selected = path;
    if (commit && commit !== this.commit) {
      this.comparisonPaths =
        typeof commit === 'object'
          ? commit.entries.map((entry) => entry.path)
          : (await this.options.request({ op: 'git-commit', ref: commit })).entries.map(
              (entry) => entry.path,
            );
      if (generation !== this.generation) return;
    }
    this.commit = commit;
    if (edge) this.options.onDiff();
    const diffViewState = edge === null ? this.diff?.saveViewState() : undefined;
    const addedViewState = edge === null ? this.addedEditor?.saveViewState() : undefined;
    // 再取得で表示方式 (左右比較・単独表示) が変わっても、隠れた方のエディタにフォーカスを戻さない。
    const focusedSide =
      edge !== null
        ? undefined
        : this.diff?.getOriginalEditor().hasTextFocus()
          ? 'original'
          : this.activeEditor()?.hasTextFocus()
            ? 'modified'
            : undefined;
    const stage = { name: 'start' };
    try {
      this.show(path, commit, result, workingModel, generation, edge, stage, {
        diffViewState,
        addedViewState,
        focusedSide,
      });
    } catch (error) {
      // 途中で失敗した表示は使い回さず、閉じた状態に戻してから知らせる。作業ツリーのモデルは DocumentStore が持つ。
      // どの段階で失敗したかを本文抜きで記録し、再現の難しい例外 (activeElement など) の追跡に使う。
      console.error('Diff view failed', {
        stage: stage.name,
        generation,
        view: result.image ? 'image' : result.originalExists ? 'diff' : 'added',
        editable: result.editable,
        activeElement: document.activeElement?.tagName,
        error,
      });
      this.close();
      throw new Error(`Diff view failed while ${stage.name}: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }
  private show(
    path: string,
    commit: string | PullRequestComparison | undefined,
    result: DiffView,
    workingModel: monaco.editor.ITextModel | undefined,
    generation: number,
    edge: 'first' | 'last' | null,
    stage: { name: string },
    restore: {
      diffViewState?: ReturnType<NaturalDiff['saveViewState']>;
      addedViewState?: monaco.editor.ICodeEditorViewState | null;
      focusedSide?: 'original' | 'modified';
    },
  ): void {
    const { diffViewState, addedViewState, focusedSide } = restore;
    stage.name = 'updating labels';
    requireElement('#diff-path', this.view).textContent =
      typeof commit === 'object' ? `PR #${commit.number} · ${commit.title} · ${path}` : path;
    requireElement<HTMLElement>('#diff-open', this.view).hidden = !result.inWorkingTree;
    const header = requireElement<HTMLElement>('.diff-labels', this.view);
    const labels = header.querySelectorAll<HTMLElement>(':scope > div');
    for (const [index, label, file] of [
      [0, result.originalLabel, result.originalPath ?? path],
      [1, result.modifiedLabel, path],
    ] as const) {
      requireElement('.diff-revision', labels[index]).textContent = label;
      const filename = requireElement<HTMLElement>('.diff-path', labels[index]);
      filename.textContent = file;
      filename.title = file;
    }
    this.contentSubscription?.dispose();
    this.previewUpdate = undefined;
    stage.name = 'detaching previous models';
    this.diff?.setModel(null);
    this.addedEditor?.setModel(null);
    for (const model of this.models) model.dispose();
    this.models = [];
    const svg = /\.svg$/i.test(path);
    const previewHost = requireElement<HTMLElement>('.diff-images', this.view);
    this.previewMode = result.image;
    const updateIdentical = (): void => {
      this.identical =
        result.originalExists && result.original === (workingModel?.getValue() ?? result.modified);
      requireElement<HTMLElement>('#diff-identical', this.view).hidden = !this.identical;
    };
    updateIdentical();
    const updatePreview = (): void => {
      // 画像プレビューは左右比較を維持し、新規ファイルのコードだけを全面表示する。
      const singlePane = !result.originalExists && !this.previewMode;
      labels[0].hidden = singlePane;
      header.classList.toggle('diff-labels-single', singlePane);
      header.classList.toggle('diff-labels-images', this.previewMode);
      previewHost.hidden = !this.previewMode;
      requireElement<HTMLElement>('.diff-editor', this.view).hidden =
        this.previewMode || singlePane;
      requireElement<HTMLElement>('.added-editor', this.view).hidden = !singlePane;
      requireElement<HTMLElement>('#diff-wrap', this.view).hidden = this.previewMode;

      requireElement<HTMLElement>('#diff-preview', this.view).hidden = !svg;
      setTogglePressed(requireElement('#diff-preview', this.view), this.previewMode);
      renderImageDiff(
        previewHost,
        this.previewMode
          ? { before: result.original, after: workingModel?.getValue() ?? result.modified, svg }
          : undefined,
      );
      if (!this.previewMode) {
        this.diff?.layout();
        this.addedEditor?.layout();
      }
    };
    this.previewUpdate = updatePreview;
    stage.name = 'switching view';
    updatePreview();
    if (typeof commit === 'object')
      this.options.annotations.shareFile({
        root: commit.repositoryRoot,
        path,
        pullRequest: {
          number: commit.number,
          url: commit.url,
          baseCommit: commit.baseCommit,
          headCommit: commit.headCommit,
        },
      });
    if (result.image) {
      this.navigationReady = true;
      this.render();
      return;
    }
    const appearance = rendererTheme();
    const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
      theme: 'workbench',
      automaticLayout: true,
      fontSize: appearance.editorFontSize,
      fontFamily: appearance.fontFamily,
      lineHeight: appearance.editorLineHeight,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    };
    const modified =
      workingModel ?? monaco.editor.createModel(result.modified, this.options.language(path));
    // 作業ツリー側のモデルは DocumentStore のもの。差分を閉じても破棄しない。
    if (!workingModel) this.models = [modified];
    const updateContent = (): void => {
      updateIdentical();
      if (this.previewMode) updatePreview();
    };
    if (!result.originalExists) {
      // 空モデルにも1行あるため、差分計算では架空の削除行が出る。新規は単独エディタで全行を追加として描く。
      stage.name = 'preparing the single editor';
      if (!this.addedEditor) {
        this.addedEditor = monaco.editor.create(requireElement('.added-editor', this.view), {
          ...editorOptions,
          model: null,
        });
        this.bindEditor(this.addedEditor);
      }
      this.addedEditor.updateOptions({ readOnly: !workingModel });
      stage.name = 'setting the single editor model';
      this.addedEditor.setModel(modified);
      stage.name = 'restoring the single editor state';
      if (addedViewState) this.addedEditor.restoreViewState(addedViewState);
      if (focusedSide) this.addedEditor.focus();
      const decorations = this.addedEditor.createDecorationsCollection();
      const decorate = (): void => {
        decorations.set([
          {
            range: modified.getFullModelRange(),
            options: {
              isWholeLine: true,
              className: 'added-file-line',
              marginClassName: 'added-file-line',
            },
          },
        ]);
      };
      decorate();
      const subscription = modified.onDidChangeContent(() => {
        decorate();
        updateContent();
      });
      this.contentSubscription = {
        dispose: () => {
          subscription.dispose();
          decorations.clear();
        },
      };
      this.applyWrapping();
      this.navigationReady = true;
      if (edge) this.revealChange(1);
      this.render();
      return;
    }
    if (workingModel) this.contentSubscription = workingModel.onDidChangeContent(updateContent);
    stage.name = 'preparing the diff editors';
    const firstOpen = !this.diff;
    this.diff ??= new NaturalDiff(
      requireElement('.diff-editor', this.view),
      editorOptions,
      this.options.report,
      (columns) => header.style.setProperty('--diff-columns', columns),
    );
    if (firstOpen) {
      this.bindEditor(this.diff.getModifiedEditor());
      this.diff.onDidUpdateDiff(() => {
        const choice = this.partial.get(this.selected);
        if (
          !this.commit &&
          choice &&
          this.diff?.isReady() &&
          (choice.before !== this.diff.getOriginalEditor().getModel()?.getValue() ||
            choice.after !== this.diff.getModifiedEditor().getModel()?.getValue())
        ) {
          this.partial.delete(this.selected);
          this.tree.setChecked(this.selected, false);
        }
        this.updateNavigation();
      });
    }
    this.diff.selection =
      !commit && result.editable
        ? {
            checked: (index) =>
              this.partial.get(this.selected)?.changes.includes(index) ??
              this.checkedPaths.includes(this.selected),
            toggle: (index, checked) => {
              const diff = this.diff;
              const before = diff?.getOriginalEditor().getModel()?.getValue();
              const after = diff?.getModifiedEditor().getModel()?.getValue();
              // 差分が確定していない間の選択は、どの行を指すか決まらないので受け付けない。
              if (!diff?.isReady() || before === undefined || after === undefined) return;
              const choices = new Set(
                this.partial.get(this.selected)?.changes ??
                  (this.checkedPaths.includes(this.selected)
                    ? diff.getLineChanges().map((_, i) => i)
                    : []),
              );
              if (checked) choices.add(index);
              else choices.delete(index);
              if (choices.size && choices.size < diff.getLineChanges().length)
                this.partial.set(this.selected, {
                  path: this.selected,
                  before,
                  after,
                  changes: [...choices],
                });
              else this.partial.delete(this.selected);
              this.tree.setChecked(this.selected, choices.size === diff.getLineChanges().length);
            },
          }
        : undefined;
    const selection = this.partial.get(path);
    if (
      !commit &&
      selection &&
      (selection.before !== result.original || selection.after !== result.modified)
    )
      this.partial.delete(path);
    this.diff.updateOptions({ readOnly: !workingModel });
    this.applyWrapping();
    const original = monaco.editor.createModel(result.original, this.options.language(path));
    this.models.push(original);
    // 差分計算は入力が止まってから非同期に行う。計算完了後に一度だけ移動し、編集時の再計算ではカーソルを奪わない。
    this.diffSubscription = this.diff.onDidUpdateDiff(() => {
      if (generation !== this.generation || !this.diff?.isSettled()) return;
      this.diffSubscription?.dispose();
      this.navigationReady = true;
      this.updateNavigation();
      if (edge) {
        const lines = this.changeLines();
        this.revealChange((edge === 'last' ? lines.at(-1) : lines[0]) ?? 1);
      }
    });
    this.diffDecoration = decorateDiff(this.diff);
    stage.name = 'setting the diff models';
    this.diff.setModel({ original, modified });
    stage.name = 'restoring the diff state';
    if (diffViewState) this.diff.restoreViewState(diffViewState);
    if (focusedSide === 'original') this.diff.getOriginalEditor().focus();
    else if (focusedSide) this.diff.getModifiedEditor().focus();
    this.render();
  }
  close(): void {
    this.generation++;
    this.navigationReady = false;
    this.diffSubscription?.dispose();
    this.diffDecoration?.dispose();
    this.contentSubscription?.dispose();
    this.previewUpdate = undefined;
    renderImageDiff(requireElement('.diff-images', this.view));
    this.diff?.setModel(null);
    this.addedEditor?.setModel(null);
    for (const model of this.models) model.dispose();
    this.models = [];
    this.selected = '';
    this.commit = undefined;
    this.render();
    this.options.onClose();
  }
}
