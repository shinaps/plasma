import * as monaco from 'monaco-editor/editor/editor.api';
import { attachDocumentPreview } from './document-preview';
import { createFileTabs } from './file-tabs';
import { registerWrapping } from './wrapping';

export type SplitDirection = 'right' | 'down';
type SplitTab =
  | { model: monaco.editor.ITextModel; view?: never; label?: never; settings?: never }
  | { model?: never; view: HTMLElement; label: string; settings?: boolean };

/** 2 つ目のエディタ。モデルは DocumentStore と共有し、ここでは寿命を持たない。 */
export class SplitEditor {
  readonly pane = document.createElement('section');
  readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly container: HTMLElement;
  private readonly onClose: (path: string) => void;
  private readonly onCloseTabs: (except?: string) => void;
  private readonly separator = document.createElement('div');
  private readonly tabs = document.createElement('div');
  private readonly host = document.createElement('div');
  private readonly entries = new Map<string, SplitTab>();
  private readonly surface: HTMLElement;
  private direction: SplitDirection = 'right';
  private ratio = 50;
  private active = '';
  private readonly renderTabs: ReturnType<typeof createFileTabs>;
  private readonly toggleWrapping: () => void;
  /**
   * @param container 左右または上下に並べる親要素。区切り線とペインをここに追加する
   * @param options メインエディタと同じ Monaco の設定
   * @param onClose タブの × で呼ぶ。右側だけで開いている文書を閉じる判断は呼び出し側が行う
   * @param onCloseTabs 「他を閉じる」「すべて閉じる」で呼ぶ。except は残すタブのパス
   */
  constructor(
    container: HTMLElement,
    options: monaco.editor.IStandaloneEditorConstructionOptions,
    onClose: (path: string) => void,
    onCloseTabs: (except?: string) => void,
  ) {
    this.container = container;
    this.onClose = onClose;
    this.onCloseTabs = onCloseTabs;
    this.pane.className =
      'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-panel bg-background shadow-panel';
    this.pane.style.width = '50%';
    this.pane.setAttribute('aria-label', 'Secondary editor');
    this.tabs.className = 'flex h-full min-w-0 flex-1 gap-1.5 overflow-x-auto';
    this.tabs.role = 'tablist';
    this.tabs.setAttribute('aria-label', 'Secondary editor tabs');
    this.host.className = 'min-h-0 flex-1';
    const header = document.createElement('div');
    header.className = 'flex h-12 shrink-0 items-center gap-1 p-2';
    header.append(this.tabs);
    this.pane.append(header, this.host);
    this.separator.className =
      'w-2 shrink-0 cursor-col-resize touch-none rounded-control hover:bg-accent';
    this.separator.role = 'separator';
    this.separator.tabIndex = 0;
    this.separator.setAttribute('aria-label', 'Editor split size');
    this.separator.setAttribute('aria-orientation', 'vertical');
    const resize = (percent: number): void => {
      this.ratio = Math.max(20, Math.min(80, percent));
      this.applyLayout();
    };
    this.separator.onpointerdown = (event) => {
      if (event.button === 0) this.separator.setPointerCapture(event.pointerId);
    };
    this.separator.onpointermove = (event) => {
      if (this.separator.hasPointerCapture(event.pointerId)) {
        const bounds = container.getBoundingClientRect();
        resize(
          this.direction === 'right'
            ? ((bounds.right - event.clientX) / bounds.width) * 100
            : ((bounds.bottom - event.clientY) / bounds.height) * 100,
        );
      }
    };
    this.separator.onpointerup = (event) => this.separator.releasePointerCapture(event.pointerId);
    this.separator.onkeydown = (event) => {
      const decrease = this.direction === 'right' ? 'ArrowRight' : 'ArrowDown';
      const increase = this.direction === 'right' ? 'ArrowLeft' : 'ArrowUp';
      if (event.key === decrease || event.key === increase) {
        event.preventDefault();
        resize(this.ratio + (event.key === increase ? 5 : -5));
      }
    };
    container.append(this.separator, this.pane);
    this.editor = monaco.editor.create(this.host, {
      ...options,
      ariaLabel: 'Secondary code editor',
    });
    const toolbar = document.createElement('div');
    toolbar.className = 'flex shrink-0 items-center gap-1';
    this.toggleWrapping = registerWrapping(this.editor);
    header.append(toolbar);
    this.surface = attachDocumentPreview(this.editor, this.host, toolbar);
    this.renderTabs = createFileTabs(this.tabs);
    this.render();
  }
  get path(): string {
    return this.active;
  }
  /**
   * @param viewState 移動元のエディタで保存した表示状態。選択とスクロール位置を引き継ぐ
   */
  open(
    path: string,
    model: monaco.editor.ITextModel,
    direction = this.direction,
    viewState?: monaco.editor.ICodeEditorViewState | null,
  ): void {
    this.direction = direction;
    this.entries.set(path, { model });
    this.active = path;
    this.render();
    if (viewState) {
      // 隠れていたペインは自動レイアウトがまだ届かず高さ 0 のため、先に寸法を確定しないとスクロール位置が 0 に丸められる。
      this.editor.layout();
      this.editor.restoreViewState(viewState);
    }
    this.editor.focus();
  }
  openSettingsView(id: string, view: HTMLElement, label: string, direction = this.direction): void {
    this.entries.set(id, { view, label, settings: true });
    this.pane.append(view);
    this.activate(id, direction);
  }
  private activate(id: string, direction = this.direction): void {
    this.direction = direction;
    this.active = id;
    this.render();
    const entry = this.entries.get(id);
    if (entry?.view)
      entry.view.querySelector<HTMLElement>('[role=tab][aria-selected=true], input')?.focus();
    else this.editor.focus();
  }
  close(path = this.active): void {
    const entry = this.entries.get(path);
    if (entry?.view) entry.view.hidden = true;
    this.entries.delete(path);
    if (path === this.active) this.active = [...this.entries.keys()].at(-1) ?? '';
    // 空になったら向きを既定に戻す。ドラッグ中の表示 (右半分) と置き先を一致させるため。
    if (!this.entries.size) this.direction = 'right';
    this.render();
  }
  clear(): void {
    for (const entry of this.entries.values()) if (entry.view) entry.view.hidden = true;
    this.entries.clear();
    this.active = '';
    this.direction = 'right';
    this.render();
  }
  private applyLayout(): void {
    const down = this.direction === 'down' && !!this.active;
    this.container.style.flexDirection = down ? 'column' : 'row';
    this.container.dataset.splitDirection = down ? 'down' : 'right';
    this.pane.style.width = down ? '100%' : `${this.ratio}%`;
    this.pane.style.height = down ? `${this.ratio}%` : '100%';
    this.pane.style.flexShrink = '0';
    this.separator.className = down
      ? 'h-2 shrink-0 cursor-row-resize touch-none rounded-control hover:bg-accent'
      : 'w-2 shrink-0 cursor-col-resize touch-none rounded-control hover:bg-accent';
    this.separator.setAttribute('aria-orientation', down ? 'horizontal' : 'vertical');
    this.separator.setAttribute('aria-valuenow', String(this.ratio));
  }
  private render(): void {
    this.applyLayout();
    this.pane.hidden = this.separator.hidden = !this.active;
    this.editor.setModel(this.entries.get(this.active)?.model ?? null);
    this.surface.hidden = !!this.entries.get(this.active)?.view;
    for (const [id, entry] of this.entries) if (entry.view) entry.view.hidden = id !== this.active;
    this.renderTabs(
      [...this.entries].map(([path, entry]) => ({
        id: path,
        title: entry.label ?? path,
        label: entry.label ?? path.split('/').at(-1) ?? path,
        settings: entry.settings,
        active: path === this.active,
        open: () => this.activate(path),
        close: () => this.onClose(path),
        group: 'right',
        split: (direction) => this.activate(path, direction),
        closeAll: () => this.onCloseTabs(),
        closeOthers: () => this.onCloseTabs(path),
        wrap: entry.model
          ? () => {
              this.activate(path);
              this.toggleWrapping();
            }
          : undefined,
      })),
    );
  }
}
