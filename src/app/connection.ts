import { App } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { version } from '../../package.json';
import {
  type ClientRequest,
  errorResponseSchema,
  type ResponseOf,
  type SendRequest,
} from '../../shared/protocol.ts';

/** サーバーとの接続。要求は送信時のプロジェクトに固定されるので、画面遷移が処理中の要求の宛先を変えることはない。 */
export class Connection {
  /** 会話パネルの iframe に埋め込まれて動いているか。単体の開発用 UI では false。 */
  readonly embedded = window.parent !== window;
  onNavigate?: (route: string) => void;
  private readonly getRoot: () => string;
  private app?: App;
  private hostExtensions?: OpenAIExtensions;
  private token = '';
  private toolRoute?: string;
  private workspaceQueue: Promise<unknown> = Promise.resolve();
  /** 長い外部アクセス (gh とリモートの fetch) の列。保存やポーリングの後ろに並ばない。 */
  private remoteQueue: Promise<unknown> = Promise.resolve();
  /** タブごとの入出力の列。別のタブの読み取り待ちが入力を遅らせない。id の無い操作は共通の列に並ぶ */
  private readonly terminalQueues = new Map<string, Promise<unknown>>();
  constructor(getRoot: () => string) {
    this.getRoot = getRoot;
    if (this.embedded) return;
    // トークンは URL のフラグメントで受け取り、すぐに URL から消す。再読込のために sessionStorage に残す。
    this.token = location.hash.slice(1);
    if (this.token) sessionStorage.setItem('workbench-token', this.token);
    this.token ||= sessionStorage.getItem('workbench-token') ?? '';
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }
  /** 会話へ送る機能。埋め込みでないときや接続前は undefined。 */
  get extensions(): OpenAIExtensions | undefined {
    return this.hostExtensions;
  }
  /** 会話から開くよう指示されたリンク。埋め込まれていないときは常に undefined。 */
  get route(): string | undefined {
    return this.toolRoute;
  }
  async connect(): Promise<void> {
    if (!this.embedded) return;
    this.app = new App({ name: 'Plasma', version });
    this.hostExtensions = new OpenAIExtensions(this.app);
    this.app.addEventListener('toolinput', ({ arguments: input }) => {
      if (typeof input?.route !== 'string') return;
      // ツールの入力はこの会話パネル宛て。サイドバーのアプリはリンクで開く。
      this.toolRoute = input.route;
      this.onNavigate?.(input.route);
    });
    await this.app.connect();
  }
  /**
   * root は現在のプロジェクトで必ず上書きする。呼び出し側が root を書いても型では止まらないので、ここで揃える。
   * 要求は種類ごとの直列キューに並べる。文書と Git の操作は 1 本の列で順序を保ち、ターミナルはタブごと、
   * プルリクエストの取得は別の列にして、長い処理が無関係な操作を待たせない。
   */
  request: SendRequest = <Input extends ClientRequest>(input: Input) => {
    const scoped = { ...input, root: this.getRoot() };
    const key = this.queueKey(scoped);
    const queue =
      key === 'workspace'
        ? this.workspaceQueue
        : key === 'remote'
          ? this.remoteQueue
          : (this.terminalQueues.get(key) ?? Promise.resolve());
    // 応答はサーバーと同じ契約から作られる。同一プロセスか loopback の中だけを通るので、ここでは検証しない。
    const result = queue.then(() => this.send(scoped)) as Promise<ResponseOf<Input['op']>>;
    const settled = result.catch(() => undefined);
    if (key === 'workspace') this.workspaceQueue = settled;
    else if (key === 'remote') this.remoteQueue = settled;
    else {
      this.terminalQueues.set(key, settled);
      // 閉じたタブの列は、その close が終わった後に消す。
      if (scoped.op === 'terminal-close')
        void settled.then(() => {
          if (this.terminalQueues.get(key) === settled) this.terminalQueues.delete(key);
        });
    }
    return result;
  };
  private queueKey(input: ClientRequest): string {
    if (input.op.startsWith('git-pr-')) return 'remote';
    if (!input.op.startsWith('terminal-')) return 'workspace';
    return 'id' in input ? `terminal:${input.id}` : 'terminal';
  }
  async settle(): Promise<void> {
    await Promise.all([this.workspaceQueue, this.remoteQueue, ...this.terminalQueues.values()]);
  }
  private async send(input: ClientRequest & { root: string }): Promise<unknown> {
    if (this.app) {
      const result = await this.app.callServerTool({
        name: input.op.startsWith('terminal-') ? 'workbench_terminal' : 'workbench_request',
        arguments: input,
      });
      if (result.isError) {
        const text = result.content
          ?.filter((content) => content.type === 'text')
          .map((content) => content.text)
          .join('\n');
        throw new Error(text || 'The request failed.');
      }
      return result.structuredContent;
    }
    let response: Response;
    try {
      response = await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workbench-Token': this.token },
        body: JSON.stringify(input),
      });
    } catch (error) {
      // ブラウザの TypeError (Failed to fetch) は原因を伝えないので、次にすることを示す。
      throw new Error('The Plasma server is not reachable. Restart it and open the printed URL.', {
        cause: error,
      });
    }
    const body = await response.text();
    if (!response.ok) throw new Error(failureMessage(response.status, body));
    return body ? JSON.parse(body) : undefined;
  }
}

/** 失敗した応答の文言。本文が無い (403 など) か JSON でないときは、状態コードと次にすることを示す。 */
function failureMessage(status: number, body: string): string {
  try {
    const failure = errorResponseSchema.safeParse(JSON.parse(body));
    if (failure.success) return failure.data.error;
  } catch {
    // 本文が JSON でない。状態コードの文言に倒す。
  }
  return `Request failed with status ${status}. Open the URL printed by the server.`;
}
