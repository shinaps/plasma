import type { OpenAIExtensions } from '@openai/mcp-extensions/app';
import * as monaco from 'monaco-editor/editor/editor.api';
import { errorMessage } from '../../../shared/errors.ts';
import { buttonHtml } from '../../components/ui/button';
import { createTextarea } from '../../components/ui/textarea';
import { requireElement } from '../../lib/dom';
import type { Report } from '../../lib/report';
import {
  type Reference,
  referenceText,
  SelectionShare,
  type SelectionTarget as Target,
} from './selection-share';

type Options = {
  /** 注釈パネルを置く要素。パネルはこの要素の座標で位置を決める */
  host: HTMLElement;
  /** 会話へ送る機能。プラグインとして動いていないときは undefined */
  extensions: () => OpenAIExtensions | undefined;
  report: Report;
  /** 表示中のターミナルタブにテキストを貼り付ける。Enter は送らない */
  pasteTerminal: (text: string) => Promise<void>;
};

/** 注釈パネルを置く位置の余白。上はツールバーの下、下は通知欄の上に収める。 */
const panelMargin = { top: 72, bottom: 28, side: 8 };

/** 選択したコードへの注釈。参照のコピー、ターミナルへの貼り付け、会話への送信を行う。 */
export class Annotations {
  private readonly host: HTMLElement;
  private readonly extensions: () => OpenAIExtensions | undefined;
  private readonly report: Report;
  private readonly pasteTerminal: (text: string) => Promise<void>;
  private current?: Target;
  private draft?: Target;
  private sending = false;
  private readonly sharing: SelectionShare;
  private readonly panel = document.createElement('section');
  private readonly comment: HTMLTextAreaElement;
  private readonly send: HTMLButtonElement;
  constructor(options: Options) {
    this.host = options.host;
    this.extensions = options.extensions;
    this.report = options.report;
    this.pasteTerminal = options.pasteTerminal;
    this.sharing = new SelectionShare({ extensions: options.extensions, report: options.report });
    // annotation-panel はキーボードショートカットの除外判定 (Cmd+W など) から参照する。
    this.panel.className =
      'annotation-panel absolute z-20 w-96 max-w-full rounded-control border border-border bg-surface p-2 text-caption shadow-popover';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Code annotation');
    this.panel.innerHTML = `<div class="flex items-center gap-2 pt-1 pb-2 [&_strong]:flex-1 [&_strong]:truncate [&_strong]:text-caption"><strong></strong></div><div class="annotation-field"></div><div class="mt-1 flex flex-wrap items-center justify-end gap-2 [&_button]:rounded-control [&_button]:px-2.5 [&_button]:py-1.5 [&_button]:whitespace-nowrap">${buttonHtml({ className: 'annotation-copy', attributes: { title: 'Copy Reference' } }, 'Copy')}${buttonHtml({ className: 'annotation-terminal', attributes: { title: 'Paste reference and comment without executing' } }, 'Send to Terminal')}${buttonHtml({ variant: 'secondary', size: 'sm', className: 'annotation-send', attributes: { title: 'Send to Chat' } }, 'Send')}</div>`;
    this.host.append(this.panel);
    this.comment = createTextarea(
      'min-h-14 max-h-48 resize-none overflow-y-auto p-2 text-caption leading-relaxed',
    );
    this.comment.setAttribute('aria-label', 'Comment');
    this.comment.placeholder = 'Ask about this code…';
    this.comment.rows = 2;
    requireElement('.annotation-field', this.panel).replaceWith(this.comment);
    this.send = requireElement('.annotation-send', this.panel);
    // 外側のクリックは欄を隠すだけで、書きかけと対象は保つ (コードを見に行って戻れる)。破棄は Escape で明示する。
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.panel.hidden && !this.panel.contains(event.target as Node))
          this.panel.hidden = true;
      },
      true,
    );
    requireElement<HTMLButtonElement>('.annotation-copy', this.panel).onclick = () =>
      void this.copy();
    requireElement<HTMLButtonElement>('.annotation-terminal', this.panel).onclick = () =>
      void this.toTerminal();
    this.send.onclick = () => void this.submit();
    this.comment.oninput = () => {
      this.resizeComment();
      this.updateSend();
    };
    new ResizeObserver(() => this.resizeComment()).observe(this.host);
    this.panel.onkeydown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        if (!this.send.disabled) void this.submit();
      }
    };
  }
  /**
   * エディタの選択を追い、注釈のアクションを登録する。
   * @param context 選択が属するプロジェクトとファイル。エディタに対象が無いときは undefined
   */
  bind(
    editor: monaco.editor.IStandaloneCodeEditor,
    context: () => Reference | undefined,
  ): { refresh: () => void } {
    let selecting = false;
    const update = (settled = false): void => {
      const source = context();
      const model = editor.getModel();
      const selection = editor.getSelection();
      if (!source || !model || !selection) return;
      const endLine =
        selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber
          ? selection.endLineNumber - 1
          : selection.endLineNumber;
      const next = {
        ...source,
        startLine: selection.startLineNumber,
        endLine,
        selected: !selection.isEmpty(),
      };
      const changed = JSON.stringify(next) !== JSON.stringify(this.current);
      this.current = next;
      if ((changed || settled) && !selecting && !this.comment.value.trim() && !this.sending) {
        this.close();
      }
      if (!this.panel.hidden && !this.comment.value.trim()) {
        const position = editor.getScrolledVisiblePosition(selection.getEndPosition());
        if (position) {
          const bounds = editor.getContainerDomNode().getBoundingClientRect();
          const host = this.host.getBoundingClientRect();
          const x = bounds.left - host.left + position.left;
          const y = bounds.top - host.top + position.top;
          const height = this.panel.offsetHeight;
          const below = y + position.height + panelMargin.side;
          const fits = below + height < host.height - panelMargin.bottom;
          this.panel.style.left = `${Math.max(panelMargin.side, Math.min(host.width - this.panel.offsetWidth - panelMargin.side, x))}px`;
          this.panel.style.top = `${Math.max(panelMargin.top, Math.min(host.height - height - panelMargin.bottom, fits ? below : y - height - panelMargin.side))}px`;
        }
      }
      this.sharing.update(this.current, selecting);
    };
    const node = editor.getContainerDomNode();
    const start = (event: PointerEvent): void => {
      if (event.button === 0) {
        selecting = true;
        if (!this.comment.value.trim()) this.close();
      }
    };
    // Monaco はドラッグ中も選択を更新する。最後のポインタイベントまで待ってから確定する。
    const finish = (): void => {
      if (selecting) {
        selecting = false;
        requestAnimationFrame(() => update(true));
      }
    };
    const cancel = (): void => {
      selecting = false;
    };
    node.addEventListener('pointerdown', start, true);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    const refresh = (): void => update();
    editor.onDidChangeCursorSelection(refresh);
    editor.onDidFocusEditorText(refresh);
    editor.onDidChangeModel(refresh);
    editor.onDidScrollChange(refresh);
    editor.onDidChangeModelContent(refresh);
    editor.addAction({
      id: 'workbench.annotate',
      label: 'Add Comment',
      contextMenuGroupId: 'navigation',
      precondition: 'editorHasSelection',
      run: () => {
        update();
        this.begin();
      },
    });
    // 選択は自動ではターミナルに送らない。前面で動いているプログラムを壊さないため、利用者の操作でだけ貼り付ける。
    editor.addAction({
      id: 'workbench.sendSelectionToTerminal',
      label: 'Send Selection to Terminal',
      contextMenuGroupId: 'navigation',
      precondition: 'editorHasSelection',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyK],
      run: () => {
        update();
        if (this.current?.selected)
          void this.pasteTerminal(referenceText(this.current)).catch((error) =>
            this.report(errorMessage(error), true),
          );
      },
    });
    return { refresh };
  }
  shareFile(reference: Reference): void {
    this.current = { ...reference, startLine: 1, endLine: 1, selected: false };
    this.sharing.update(this.current);
  }
  clear(): void {
    this.current = undefined;
    if (!this.comment.value.trim()) this.close();
    this.sharing.update(undefined);
  }
  private label(target: Target): string {
    return `${target.path}:${target.startLine}–${target.endLine}`;
  }
  private begin(): void {
    if (this.sending || !this.current || !this.current.selected) return;
    // 対象を書き始めた時点で固定する。画面遷移で書きかけの注釈の対象が変わらない。
    // 隠しただけの書きかけは同じ対象なら戻し、別の対象を選び直したときだけ捨てる。
    if (this.draft && JSON.stringify(this.draft) !== JSON.stringify(this.current))
      this.comment.value = '';
    this.draft = { ...this.current };
    requireElement('strong', this.panel).textContent =
      `${this.draft.path.split('/').at(-1)}:${this.draft.startLine}${this.draft.endLine === this.draft.startLine ? '' : `–${this.draft.endLine}`}`;
    requireElement('strong', this.panel).title = this.label(this.draft);
    this.panel.hidden = false;
    this.resizeComment();
    this.updateSend();
    this.comment.focus();
  }
  private resizeComment(): void {
    if (this.panel.hidden) return;
    this.comment.style.height = 'auto';
    this.comment.style.height = `${this.comment.scrollHeight + 2}px`;
    // 本文が伸びてもボタンがエディタの下にはみ出さないようにする。
    const top = Number.parseFloat(this.panel.style.top) || panelMargin.top;
    this.panel.style.top = `${Math.max(panelMargin.side, Math.min(top, this.host.clientHeight - this.panel.offsetHeight - panelMargin.bottom))}px`;
  }
  private close(): void {
    if (this.sending) return;
    this.comment.value = '';
    this.panel.hidden = true;
    this.draft = undefined;
  }
  private updateSend(): void {
    this.send.disabled = !this.comment.value.trim() || !this.extensions()?.message;
    this.send.title = this.extensions()?.message
      ? 'Send to Chat · ⌘Enter'
      : 'Connect the plugin to send to chat';
  }
  private async copy(): Promise<void> {
    if (!this.draft) return;
    try {
      await navigator.clipboard.writeText(referenceText(this.draft));
    } catch (error) {
      this.report(errorMessage(error), true);
    }
  }
  private async toTerminal(): Promise<void> {
    if (!this.draft) return;
    const target = { ...this.draft };
    const comment = this.comment.value.trim();
    try {
      await this.pasteTerminal(`${comment}${comment ? '  ' : ''}${referenceText(target)}`);
      this.close();
      this.report('Pasted into terminal. Press Enter to submit.');
    } catch (error) {
      this.report(errorMessage(error), true);
    }
  }
  private async submit(): Promise<void> {
    const message = this.extensions()?.message;
    if (this.sending || !message || !this.draft || !this.comment.value.trim()) return;
    this.sending = true;
    this.send.disabled = true;
    this.comment.disabled = true;
    try {
      const result = await message.send({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${this.comment.value.trim()}\n\nCode reference:\n${referenceText(this.draft)}`,
          },
        ],
        _meta: { 'openai/message': { target: 'active', send: true } },
      });
      if (result.isError)
        throw new Error('Sending to chat was rejected. Your comment is preserved.');
      this.sending = false;
      this.close();
      this.report('Annotation sent to chat.');
    } catch (error) {
      this.report(errorMessage(error), true);
    } finally {
      this.sending = false;
      this.comment.disabled = false;
      this.updateSend();
    }
  }
}
