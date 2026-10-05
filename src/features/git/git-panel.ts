import * as monaco from 'monaco-editor/editor/editor.api';
import { errorMessage } from '../../../shared/errors.ts';
import {
  type DiffView,
  emptyGitStatus,
  type GitStatus,
  type SendRequest,
} from '../../../shared/protocol.ts';
import { requireElement } from '../../lib/dom';
import { icon } from '../../lib/icons';
import { rendererTheme } from '../../styles/renderer-theme';
import type { Annotations } from '../editor/annotations';
import { GitTree } from './git-tree';
import { renderImageDiff } from './image-diff';

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
};

/** Git の変更一覧と左右比較。作業ツリーと HEAD や index の比較に加えて、履歴で選んだコミットとその親の比較も表示する。 */
export class GitPanel {
  private readonly options: GitPanelOptions;
  private readonly view: HTMLElement;
  private state: GitStatus = emptyGitStatus();
  private selected = '';
  private commit?: string;
  private generation = 0;
  private diff?: monaco.editor.IStandaloneDiffEditor;
  private wrapPreference?: boolean;
  private models: monaco.editor.ITextModel[] = [];
  private readonly tree: GitTree;
  private previewMode = false;
  private previewUpdate?: () => void;
  private previewSubscription?: monaco.IDisposable;
  constructor(options: GitPanelOptions) {
    this.options = options;
    this.view = options.view;
    options.panel.innerHTML = '<div class="change-list flex-1 overflow-auto px-1.5 pb-2.5"></div>';
    this.tree = new GitTree(
      requireElement('.change-list', options.panel),
      (path) => void this.open(path).catch((error) => options.report(errorMessage(error))),
    );
    this.view.innerHTML =
      '<div class="diff-toolbar flex min-h-10 shrink-0 items-center gap-1.5 px-3 [&_strong]:flex-1 [&_strong]:truncate [&_strong]:text-caption [&_strong]:font-medium [&_button]:size-7 [&_button]:rounded-control [&_button]:text-body"><strong id="diff-path"></strong><button id="diff-preview" hidden class="inline-grid place-items-center aria-pressed:bg-accent" title="Image Preview" aria-label="Image Preview" aria-pressed="false"></button><button id="diff-open" class="inline-grid place-items-center" aria-label="Open Working File" title="Open Working File"></button><button id="diff-wrap" class="inline-grid place-items-center text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground" aria-label="Word Wrap" aria-pressed="false" title="Wrap text on both sides"></button><button id="previous-change" title="Previous Change" aria-label="Previous Change">↑</button><button id="next-change" title="Next Change" aria-label="Next Change">↓</button><button id="close-diff" aria-label="Close Diff" title="Close Diff">×</button></div><div class="diff-labels flex bg-background [&_span]:w-1/2 [&_span]:px-4 [&_span]:py-1.5 [&_span]:text-caption [&_span]:text-foreground"><span></span><span></span></div><div class="diff-images min-h-0 flex-1" hidden></div><div class="diff-editor min-h-0 flex-1"></div>';
    requireElement<HTMLButtonElement>('#diff-open', this.view).onclick = () => {
      const position =
        this.commit || this.previewMode
          ? undefined
          : (this.diff?.getModifiedEditor().getPosition() ?? undefined);
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
    requireElement<HTMLButtonElement>('#close-diff', this.view).onclick = () => this.close();
    requireElement<HTMLButtonElement>('#previous-change', this.view).onclick = () =>
      this.diff?.goToDiff('previous');
    requireElement<HTMLButtonElement>('#next-change', this.view).onclick = () =>
      this.diff?.goToDiff('next');
  }
  private applyWrapping(): void {
    // 長い文章は折り返した方が読める。明示した選択はその後の比較にも使う。
    const wrap = this.wrapPreference ?? this.options.language(this.selected) === 'markdown';
    this.diff?.updateOptions({ diffWordWrap: wrap ? 'on' : 'off' });
    requireElement('#diff-wrap', this.view).setAttribute('aria-pressed', String(wrap));
  }
  updateFontSize(): void {
    const theme = rendererTheme();
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
    if (this.commit) this.close();
  }
  reset(): void {
    this.close();
    this.tree.reset();
    this.state = emptyGitStatus();
    this.render();
  }
  expandSelected(): void {
    this.tree.expandSelected();
  }
  collapseAll(): void {
    this.tree.setAllExpanded(false);
  }
  /** 文書を閉じるときに呼ぶ。その文書を作業ツリー側に表示している差分だけを閉じる。 */
  release(path: string): void {
    if (this.selected === path && !this.commit) this.close();
  }
  async refreshSelection(): Promise<void> {
    if (!this.selected) return;
    if (this.commit || this.hasEntry(this.selected)) await this.open(this.selected, this.commit);
    else this.close();
  }
  private render(): void {
    this.tree.update(this.state.entries, this.commit ? '' : this.selected, this.state.available);
  }

  async open(path: string, commit?: string): Promise<void> {
    const generation = ++this.generation;
    const result: DiffView = commit
      ? await this.options.request({ op: 'git-commit-diff', path, ref: commit })
      : await this.options.request({ op: 'git-diff', path });
    if (generation !== this.generation) return;
    const workingModel = result.editable ? await this.options.loadWorkingModel(path) : undefined;
    if (generation !== this.generation) return;
    this.selected = path;
    this.commit = commit;
    this.options.onDiff();
    requireElement('#diff-path', this.view).textContent = path;
    requireElement<HTMLElement>('#diff-open', this.view).hidden = !result.inWorkingTree;
    const labels = this.view.querySelectorAll('.diff-labels span');
    labels[0].textContent = result.originalLabel;
    labels[1].textContent = result.modifiedLabel;
    this.previewSubscription?.dispose();
    this.previewUpdate = undefined;
    this.diff?.setModel(null);
    for (const model of this.models) model.dispose();
    this.models = [];
    const svg = /\.svg$/i.test(path);
    const previewHost = requireElement<HTMLElement>('.diff-images', this.view);
    this.previewMode = result.image;
    const updatePreview = (): void => {
      previewHost.hidden = !this.previewMode;
      requireElement<HTMLElement>('.diff-editor', this.view).hidden = this.previewMode;
      for (const id of ['diff-wrap', 'previous-change', 'next-change'])
        requireElement<HTMLElement>(`#${id}`, this.view).hidden = this.previewMode;
      requireElement<HTMLElement>('#diff-preview', this.view).hidden = !svg;
      requireElement('#diff-preview', this.view).setAttribute(
        'aria-pressed',
        String(this.previewMode),
      );
      renderImageDiff(
        previewHost,
        this.previewMode
          ? { before: result.original, after: workingModel?.getValue() ?? result.modified, svg }
          : undefined,
      );
      if (!this.previewMode) this.diff?.layout();
    };
    this.previewUpdate = updatePreview;
    updatePreview();
    if (result.image) {
      this.render();
      return;
    }
    if (svg && workingModel)
      this.previewSubscription = workingModel.onDidChangeContent(() => {
        if (this.previewMode) updatePreview();
      });
    const firstOpen = !this.diff;
    const appearance = rendererTheme();
    this.diff ??= monaco.editor.createDiffEditor(requireElement('.diff-editor', this.view), {
      theme: 'workbench',
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      fontSize: appearance.editorFontSize,
      fontFamily: appearance.fontFamily,
      lineHeight: appearance.editorLineHeight,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      renderIndicators: true,
      contextmenu: true,
    });
    if (firstOpen) {
      this.diff.getModifiedEditor().addAction({
        id: 'workbench.save',
        label: 'Save All',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => this.options.save().catch((error) => this.options.report(errorMessage(error))),
      });
      // HEAD 側の行番号は現在のファイルを指せない。共有するのは作業ツリー側の参照だけ。
      this.options.annotations.bind(this.diff.getModifiedEditor(), () =>
        this.view.hidden || this.commit
          ? undefined
          : { root: this.options.root(), path: this.selected },
      );
    }
    this.diff.updateOptions({ readOnly: !workingModel });
    this.applyWrapping();
    const original = monaco.editor.createModel(result.original, this.options.language(path));
    const modified =
      workingModel ?? monaco.editor.createModel(result.modified, this.options.language(path));
    // 作業ツリー側のモデルは DocumentStore のもの。差分を閉じても破棄しない。
    this.models = workingModel ? [original] : [original, modified];
    this.diff.setModel({ original, modified });
    this.render();
  }
  close(): void {
    this.generation++;
    this.previewSubscription?.dispose();
    this.previewUpdate = undefined;
    renderImageDiff(requireElement('.diff-images', this.view));
    this.diff?.setModel(null);
    for (const model of this.models) model.dispose();
    this.models = [];
    this.selected = '';
    this.commit = undefined;
    this.render();
    this.options.onClose();
  }
}
