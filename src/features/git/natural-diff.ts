import * as monaco from 'monaco-editor/editor/editor.api';
import { errorMessage } from '../../../shared/errors.ts';
import { attachDiffCenter } from './diff-center';
import { computeChanges, mapOffset, revertEdit } from './diff-model';
import { attachDiffOverview } from './diff-overview';

/** Monaco の DiffEditor の代わりに、2 つのエディタと中央の列で左右を自然な行位置のまま比べる。 */
export class NaturalDiff {
  private readonly original: monaco.editor.IStandaloneCodeEditor;
  private readonly modified: monaco.editor.IStandaloneCodeEditor;
  private changes: monaco.editor.ILineChange[] = [];
  private readonly listeners = new Set<() => void>();
  /** 部分コミットの選択。index は getLineChanges() の添字。 */
  selection?: {
    checked: (index: number) => boolean;
    toggle: (index: number, checked: boolean) => void;
  };
  refreshControls(): void {
    this.emit();
  }
  private generation = 0;
  private syncing = false;
  private readOnly = true;
  /** 差分の状態。失敗は差分ゼロと区別し、取り消しと行選択を無効にしたまま計算中表示を終える。 */
  private state: 'pending' | 'ready' | 'failed' = 'pending';
  private timer?: ReturnType<typeof setTimeout>;

  private readonly report: (message: string) => void;

  /**
   * @param host 左右のエディタと中央の列を置く要素
   * @param options 両エディタに共通の Monaco の設定
   * @param report 差分計算の失敗を利用者に知らせる
   * @param resized 中央の列の幅を変えたときに grid-template-columns の値を受け取り、見出しの列幅を合わせる
   */
  constructor(
    host: HTMLElement,
    options: monaco.editor.IStandaloneEditorConstructionOptions,
    report: (message: string) => void,
    resized: (columns: string) => void,
  ) {
    this.report = report;
    host.classList.add('natural-diff');
    const left = document.createElement('div');
    const center = document.createElement('div');
    const right = document.createElement('div');
    left.className = right.className = 'natural-diff-code';
    center.className = 'natural-diff-center';
    host.replaceChildren(left, center, right);
    const common = {
      ...options,
      model: null,
      lineNumbers: 'off' as const,
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 0,
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
    };
    this.original = monaco.editor.create(left, {
      ...common,
      readOnly: true,
      renderLineHighlight: 'none',
      lineDecorationsWidth: 16,
      scrollbar: { vertical: 'hidden', verticalScrollbarSize: 0, useShadows: false },
    });
    this.modified = monaco.editor.create(right, common);
    this.original.onDidScrollChange((event) => this.sync(this.original, this.modified, event));
    this.modified.onDidScrollChange((event) => this.sync(this.modified, this.original, event));
    const changed = () => {
      // 入力中は古い範囲の取り消しを無効にし、連続入力をまとめて計算する。
      this.generation++;
      this.state = 'pending';
      this.changes = [];
      this.emit();
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.calculate(), 100);
    };
    this.modified.onDidChangeModelContent(changed);
    this.original.onDidChangeModelContent(changed);
    attachDiffCenter(this, center);
    attachDiffOverview(this, right);
    attachResize(host, center, () => {
      resized(host.style.gridTemplateColumns);
      this.layout();
    });
  }
  getOriginalEditor(): monaco.editor.IStandaloneCodeEditor {
    return this.original;
  }
  getModifiedEditor(): monaco.editor.IStandaloneCodeEditor {
    return this.modified;
  }
  getLineChanges(): readonly monaco.editor.ILineChange[] {
    return this.changes;
  }
  /** 差分が現在のモデルの内容と一致しているか。 */
  isReady(): boolean {
    return this.state === 'ready';
  }
  /** 計算が終わったか (成功・失敗を問わない)。 */
  isSettled(): boolean {
    return this.state !== 'pending';
  }
  hasFailed(): boolean {
    return this.state === 'failed';
  }
  canRevert(): boolean {
    return !this.readOnly && this.state === 'ready';
  }
  onDidUpdateDiff(listener: () => void): monaco.IDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
  private async calculate(): Promise<void> {
    const generation = this.generation;
    const original = this.original.getModel();
    const modified = this.modified.getModel();
    if (!original || !modified) return;
    try {
      const changes = await computeChanges(original.getLinesContent(), modified.getLinesContent());
      if (generation !== this.generation) return;
      this.changes = changes;
      this.state = 'ready';
      this.emit();
    } catch (error) {
      if (generation !== this.generation) return;
      this.state = 'failed';
      this.emit();
      this.report(errorMessage(error));
    }
  }
  setModel(model: monaco.editor.IDiffEditorModel | null): void {
    this.generation++;
    clearTimeout(this.timer);
    this.changes = [];
    this.state = 'pending';
    this.withoutSync(() => {
      this.original.setModel(model?.original ?? null);
      this.modified.setModel(model?.modified ?? null);
    });
    this.emit();
    if (model) void this.calculate();
  }
  /** 片側の操作がもう片側へ伝播しないようにする。例外でも解除し、以後のスクロール追従を止めない。 */
  private withoutSync(action: () => void): void {
    this.syncing = true;
    try {
      action();
    } finally {
      this.syncing = false;
    }
  }
  updateOptions(
    options: monaco.editor.IEditorOptions & { diffWordWrap?: 'on' | 'off' | 'inherit' },
  ): void {
    const { diffWordWrap, readOnly, ...common } = options;
    const wordWrap = diffWordWrap === 'on' || diffWordWrap === 'off' ? diffWordWrap : undefined;
    this.original.updateOptions({ ...common, ...(wordWrap ? { wordWrap } : {}) });
    this.modified.updateOptions({
      ...common,
      ...(wordWrap ? { wordWrap } : {}),
      ...(readOnly !== undefined ? { readOnly } : {}),
    });
    if (readOnly !== undefined) {
      this.readOnly = readOnly;
      this.emit();
    }
  }
  layout(): void {
    this.original.layout();
    this.modified.layout();
  }
  saveViewState(): {
    original: monaco.editor.ICodeEditorViewState | null;
    modified: monaco.editor.ICodeEditorViewState | null;
  } {
    return { original: this.original.saveViewState(), modified: this.modified.saveViewState() };
  }
  restoreViewState(state: ReturnType<NaturalDiff['saveViewState']>): void {
    this.withoutSync(() => {
      this.original.restoreViewState(state.original);
      this.modified.restoreViewState(state.modified);
    });
  }
  revert(change: monaco.editor.ILineChange): void {
    if (!this.canRevert() || !this.changes.includes(change)) return;
    const original = this.original.getModel();
    const modified = this.modified.getModel();
    if (!original || !modified) return;
    const edit = revertEdit(
      original.getLinesContent(),
      modified.getLinesContent(),
      change,
      modified.getEOL(),
    );
    const from = modified.getPositionAt(edit.from);
    const to = modified.getPositionAt(edit.to);
    this.modified.pushUndoStop();
    this.modified.executeEdits('plasma.revert-diff', [
      { range: monaco.Range.fromPositions(from, to), text: edit.text },
    ]);
    this.modified.pushUndoStop();
    this.modified.focus();
  }
  private sync(
    source: monaco.editor.IStandaloneCodeEditor,
    target: monaco.editor.IStandaloneCodeEditor,
    event: monaco.IScrollEvent,
  ): void {
    if (this.syncing || !event.scrollTopChanged || this.state === 'pending') return;
    const forward = source === this.original;
    const anchors: [number, number][] = [[0, 0]];
    for (const change of this.changes) {
      const sourceBounds = lineBounds(source, change, forward ? 'original' : 'modified');
      const targetBounds = lineBounds(target, change, forward ? 'modified' : 'original');
      anchors.push([sourceBounds[0], targetBounds[0]], [sourceBounds[1], targetBounds[1]]);
    }
    anchors.push([
      source.getBottomForLineNumber(source.getModel()?.getLineCount() ?? 1),
      target.getBottomForLineNumber(target.getModel()?.getLineCount() ?? 1),
    ]);
    // 上端ではなく読んでいる領域を合わせる。行数が異なる区間では短い側が端で待つ。
    const reference = source.getLayoutInfo().height / 3;
    this.withoutSync(() =>
      target.setScrollTop(
        Math.max(0, mapOffset(event.scrollTop + reference, anchors) - reference),
        monaco.editor.ScrollType.Immediate,
      ),
    );
  }
}

export function lineBounds(
  editor: monaco.editor.ICodeEditor,
  change: monaco.editor.ILineChange,
  side: 'original' | 'modified',
): [number, number] {
  const start = change[`${side}StartLineNumber`];
  const end = change[`${side}EndLineNumber`];
  if (!end) {
    const y = start ? editor.getBottomForLineNumber(start) : 0;
    return [y, y];
  }
  return [editor.getTopForLineNumber(start), editor.getBottomForLineNumber(end)];
}

/** 中央の幅は保ち、コード領域の比率だけを変えて差分の対応関係を読みやすく保つ。 */
function attachResize(host: HTMLElement, center: HTMLElement, layout: () => void): void {
  const handle = document.createElement('div');
  handle.className = 'diff-resize';
  handle.role = 'separator';
  handle.tabIndex = 0;
  handle.setAttribute('aria-label', 'Diff split size');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-valuemin', '20');
  handle.setAttribute('aria-valuemax', '80');
  handle.setAttribute('aria-valuenow', '50');
  center.prepend(handle);
  let ratio = 50;
  let startX = 0;
  let startRatio = 50;
  const resize = (value: number) => {
    ratio = Math.max(20, Math.min(80, value));
    host.style.gridTemplateColumns = `minmax(0, ${ratio}fr) 8rem minmax(0, ${100 - ratio}fr)`;
    handle.setAttribute('aria-valuenow', String(Math.round(ratio)));
    layout();
  };
  handle.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    startX = event.clientX;
    startRatio = ratio;
    handle.setPointerCapture(event.pointerId);
  };
  handle.onpointermove = (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    const width = host.clientWidth - center.offsetWidth;
    if (width > 0) resize(startRatio + ((event.clientX - startX) / width) * 100);
  };
  handle.onpointerup = (event) => handle.releasePointerCapture(event.pointerId);
  handle.onkeydown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    resize(ratio + (event.key === 'ArrowRight' ? 5 : -5));
  };
}
