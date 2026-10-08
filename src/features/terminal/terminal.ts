import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { errorMessage } from '../../../shared/errors.ts';
import { limits } from '../../../shared/limits.ts';
import type {
  ClientRequest,
  SendRequest,
  TerminalOutput,
  TerminalSession,
} from '../../../shared/protocol.ts';
import { buttonHtml, createButton } from '../../components/ui/button';
import { requireElement } from '../../lib/dom';
import { icon } from '../../lib/icons';
import type { Report } from '../../lib/report';
import { rendererTheme } from '../../styles/renderer-theme';
import { ToolDock } from '../layout/tool-dock';
import '@xterm/xterm/css/xterm.css';

type Tab = TerminalSession & {
  terminal: Terminal;
  fit: FitAddon;
  body: HTMLDivElement;
  header: HTMLDivElement;
  button: HTMLButtonElement;
  /** サーバーの出力をどこまで受け取ったか。端末のカーソル位置ではない */
  outputCursor: number;
  disposed: boolean;
  closing: boolean;
  /** 出力を読めなくなった (サーバーの再起動など)。入力を受け付けず、閉じて開き直すよう示す */
  disconnected: boolean;
  /** このタブへの入力とサイズ変更の送信順。並列に送るとシェルに届く順序が入れ替わるため */
  queue: Promise<void>;
};

/** 出力の取得に続けて失敗したとき、切断と判断するまでの回数と間隔。一時的な遅延は乗り越え、落ちたサーバーは待ち続けない。 */
const pollRetries = 5;
const pollRetryDelay = 1000;

/** ターミナルのタブ。シェルのプロセスはサーバーが持ち、ここは表示と入出力の中継だけを行う。 */
export class TerminalPanel {
  private readonly request: SendRequest;
  private readonly report: Report;
  private readonly panel = document.createElement('section');
  private readonly tabs = new Map<string, Tab>();
  private active?: Tab;
  private opening?: Promise<void>;
  private loaded = false;
  private generation = 0;
  private readonly dock: ToolDock;
  constructor(host: HTMLElement, request: SendRequest, report: Report) {
    this.request = request;
    this.report = report;
    this.panel.id = 'terminal-panel';
    this.panel.className =
      'terminal-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-panel bg-background shadow-panel';
    this.panel.hidden = true;
    this.panel.innerHTML = `<div class="flex h-12 shrink-0 items-center gap-1 bg-background p-2 text-caption"><div class="terminal-tabs flex h-full min-w-0 flex-1 gap-1.5 overflow-x-auto" role="tablist" aria-label="Terminal tabs"></div>${buttonHtml({ className: 'terminal-add grid size-8 shrink-0 place-items-center rounded-control text-muted-foreground hover:bg-accent hover:text-foreground', attributes: { 'aria-label': 'Add Terminal', title: 'New Terminal' } }, '')}${buttonHtml({ className: 'terminal-hide grid size-8 shrink-0 place-items-center rounded-control text-muted-foreground hover:bg-accent hover:text-foreground', attributes: { 'aria-label': 'Hide Terminal', title: 'Hide without closing tabs' } }, '')}</div><div class="terminal-content min-h-0 flex-1"></div>`;
    requireElement('.terminal-add', this.panel).append(icon('plus'));
    requireElement('.terminal-hide', this.panel).append(icon('minus'));
    this.dock = new ToolDock(
      host,
      this.panel,
      () => {
        if (this.panel.hidden) void this.show().catch((error) => report(errorMessage(error), true));
        else this.dock.setVisible(false);
      },
      { id: 'terminal', label: 'Terminal', initialSide: 'right' },
    );
    requireElement<HTMLButtonElement>('.terminal-hide', this.panel).onclick = () =>
      this.dock.setVisible(false);
    const add = requireElement<HTMLButtonElement>('.terminal-add', this.panel);
    add.onclick = async () => {
      add.disabled = true;
      try {
        await this.add();
      } catch (error) {
        report(errorMessage(error), true);
      } finally {
        add.disabled = false;
      }
    };
    new ResizeObserver(() => {
      if (!this.panel.hidden) this.active?.fit.fit();
    }).observe(this.panel);
  }
  async detach(): Promise<void> {
    // 処理中の要求は前のプロジェクトのもの。離れた後に表示を作ってはいけない。
    this.generation++;
    await this.opening?.catch(() => undefined);
    this.dock.setVisible(false);
    // プロジェクトを離れても表示を外すだけ。シェルを終了するのはタブを閉じたときだけ。
    for (const tab of this.tabs.values()) this.disposeTab(tab);
    this.tabs.clear();
    this.active = undefined;
    this.loaded = false;
  }
  async show(): Promise<void> {
    this.dock.setVisible(true);
    this.opening ??= this.load().finally(() => {
      this.opening = undefined;
    });
    await this.opening;
    this.active?.fit.fit();
    this.active?.terminal.focus();
  }
  updateFontSize(): void {
    const { terminalFontSize } = rendererTheme();
    for (const tab of this.tabs.values()) tab.terminal.options.fontSize = terminalFontSize;
    this.active?.fit.fit();
  }
  /** 表示中のタブにテキストを貼り付ける。Enter は送らない。 */
  async paste(text: string): Promise<void> {
    await this.show();
    const tab = this.active;
    if (!tab) throw new Error('Open a terminal tab first.');
    if (!this.canWrite(tab)) throw new Error('This terminal has ended. Open a new terminal tab.');
    this.write(tab, this.pasteData(tab, text));
    await tab.queue;
    tab.terminal.focus();
  }
  private async load(): Promise<void> {
    const generation = this.generation;
    if (!this.loaded) {
      const { sessions } = await this.request({ op: 'terminal-list' });
      if (generation !== this.generation) return;
      for (const session of sessions) this.attach(session);
      this.loaded = true;
    }
    if (!this.tabs.size) await this.add();
  }
  private async add(): Promise<void> {
    const generation = this.generation;
    const session = await this.request({ op: 'terminal-start' });
    if (generation === this.generation) this.attach(session);
  }
  private createView(session: TerminalSession) {
    const theme = rendererTheme();
    const terminal = new Terminal({
      fontSize: theme.terminalFontSize,
      fontFamily: theme.fontFamily,
      theme: { background: theme.background, foreground: theme.foreground, cursor: theme.ring },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    const body = document.createElement('div');
    const header = document.createElement('div');
    const button = createButton({
      className: 'h-full whitespace-nowrap rounded-tab px-3 text-caption',
    });
    const close = createButton({
      className:
        'mr-1 grid size-6 shrink-0 place-items-center rounded-control p-0 text-body text-muted-foreground hover:bg-surface-raised hover:text-foreground',
    });
    // FitAddon measures this padded host so the final terminal row stays inside the inset.
    body.className = 'h-full px-3 pt-1 pb-3';
    body.id = `terminal-${session.id}`;
    body.role = 'tabpanel';
    header.className =
      'flex shrink-0 items-center rounded-tab hover:bg-accent [&.active]:bg-accent [&:not(.active)]:text-muted-foreground';

    button.role = 'tab';
    button.id = `terminal-tab-${session.id}`;
    button.textContent = session.title;
    button.setAttribute('aria-controls', body.id);
    body.setAttribute('aria-labelledby', button.id);
    close.textContent = '×';
    close.setAttribute('aria-label', `Close ${session.title}`);
    close.title = 'Close tab and stop its process';
    header.append(button, close);
    requireElement('.terminal-tabs', this.panel).append(header);
    requireElement('.terminal-content', this.panel).append(body);
    terminal.loadAddon(fit);
    terminal.open(body);
    return { terminal, fit, body, header, button, close };
  }
  private attach(session: TerminalSession): void {
    const { terminal, fit, body, header, button, close } = this.createView(session);
    const tab: Tab = {
      ...session,
      terminal,
      fit,
      body,
      header,
      button,
      outputCursor: 0,
      disposed: false,
      closing: false,
      disconnected: false,
      queue: Promise.resolve(),
    };
    this.tabs.set(tab.id, tab);
    button.onclick = () => this.select(tab);
    button.onkeydown = (event) => {
      const list = [...this.tabs.values()];
      const index = list.indexOf(tab);
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      const target = step ? list[(index + step + list.length) % list.length] : undefined;
      if (target) {
        event.preventDefault();
        this.select(target);
        target.button.focus();
      }
    };
    close.onclick = () =>
      void this.close(tab).catch((error) => this.report(errorMessage(error), true));
    terminal.onData((text) => this.write(tab, text));
    terminal.onResize(({ cols, rows }) =>
      this.sendInput(tab, { op: 'terminal-resize', id: tab.id, cols, rows }),
    );
    this.select(tab);
    // 最初の大きさは変更イベント任せにしない。fit の結果が xterm の初期値と同じでも PTY は起動時の値のままになる。
    this.sendInput(tab, {
      op: 'terminal-resize',
      id: tab.id,
      cols: terminal.cols,
      rows: terminal.rows,
    });
    void this.poll(tab);
  }
  private canWrite(tab: Tab | undefined): tab is Tab {
    return !!tab && !tab.disposed && !tab.closing && !tab.disconnected && tab.exitCode === null;
  }
  /** 入力は要求 1 回の上限 (limits.terminalWrite) で区切って順に送る。長い貼り付けも丸ごと届く。 */
  private write(tab: Tab, text: string): void {
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + limits.terminalWrite, text.length);
      // サロゲートペアの途中で切ると、絵文字などが 2 つの U+FFFD になって届く。
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      this.sendInput(tab, { op: 'terminal-write', id: tab.id, text: text.slice(start, end) });
      start = end;
    }
  }
  private sendInput(tab: Tab, input: ClientRequest): void {
    if (!this.canWrite(tab)) return;
    tab.queue = tab.queue.then(() =>
      this.request(input).then(
        () => undefined,
        (error) => {
          if (!tab.disposed) this.report(errorMessage(error), true);
        },
      ),
    );
  }
  private pasteData(tab: Tab, text: string): string {
    const line = this.sanitizePastedText(text);
    return tab.terminal.modes.bracketedPasteMode ? `\x1b[200~${line}\x1b[201~` : line;
  }
  private select(tab: Tab): void {
    this.active = tab;
    for (const item of this.tabs.values()) {
      const active = item === tab;
      item.body.hidden = !active;
      item.button.setAttribute('aria-selected', String(active));
      item.button.tabIndex = active ? 0 : -1;
      item.header.classList.toggle('active', active);
    }
    if (!this.panel.hidden) {
      tab.fit.fit();
      tab.terminal.focus();
    }
  }
  private async close(tab: Tab): Promise<void> {
    if (tab.closing) return;
    tab.closing = true;
    try {
      const result = await this.request({ op: 'terminal-close', id: tab.id });
      if (result.warning) this.report(result.warning, true);
    } catch (error) {
      tab.closing = false;
      throw error;
    }
    if (tab.disposed) return;
    this.disposeTab(tab);
    const list = [...this.tabs.values()];
    const index = list.indexOf(tab);
    this.tabs.delete(tab.id);
    if (this.active === tab) {
      this.active = undefined;
      const next = list[index + 1] ?? list[index - 1];
      if (next) this.select(next);
      else this.dock.setVisible(false);
    }
  }
  private disposeTab(tab: Tab): void {
    tab.disposed = true;
    tab.terminal.dispose();
    tab.body.remove();
    tab.header.remove();
  }
  /**
   * 出力を取り続ける。読めなかった要求は数回やり直し、それでも読めなければ切断状態にして入力を止める。
   * 出力が見えないまま打たせず、タブごとに 1 本のループだけを回す (再接続で二重に読まない)。
   */
  private async poll(tab: Tab): Promise<void> {
    let failures = 0;
    while (!tab.disposed) {
      let result: TerminalOutput;
      try {
        result = await this.request({ op: 'terminal-read', id: tab.id, cursor: tab.outputCursor });
      } catch (error) {
        if (tab.disposed || tab.closing) return;
        if (++failures < pollRetries) {
          await new Promise((resolve) => setTimeout(resolve, pollRetryDelay));
          continue;
        }
        tab.disconnected = true;
        tab.button.textContent = `${tab.title} · Disconnected`;
        tab.terminal.write(
          `\r\n[Terminal output unavailable: ${errorMessage(error)}. Close this tab and open a new one.]\r\n`,
        );
        this.report(errorMessage(error), true);
        return;
      }
      failures = 0;
      if (tab.disposed) return;
      if (result.truncated) tab.terminal.write('\r\n[Earlier output omitted]\r\n');
      if (result.data) tab.terminal.write(result.data);
      tab.outputCursor = result.cursor;
      tab.exitCode = result.exitCode;
      if (result.exitCode !== null && !result.data) {
        tab.button.textContent = `${tab.title} · Exited`;
        tab.terminal.write(`\r\n[Shell exited: ${result.exitCode}]\r\n`);
        return;
      }
      // 1 回分を読み切ったときは続きがある。待たずに取り、速い出力でも保持分を取りこぼさない。
      if (result.data.length >= limits.terminalReadChunk) continue;
      // 前面のタブは短い間隔で追従し、背面のタブは MCP の呼び出し回数を抑える。
      await new Promise((resolve) =>
        setTimeout(resolve, !this.panel.hidden && this.active === tab ? 100 : 500),
      );
    }
  }
  /** 改行を空白にまとめ、制御文字を取り除く。貼り付けた参照がコマンドとして実行されないようにする。 */
  private sanitizePastedText(text: string): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ファイル参照を貼り付ける前に制御文字を取り除く。
    return text.replace(/[\r\n]+/g, '  ').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
  }
}
