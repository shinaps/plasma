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
  private terminalQueue: Promise<unknown> = Promise.resolve();
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
   * ワークスペース操作とターミナル操作は別々の直列キューに並べる。
   */
  request: SendRequest = <Input extends ClientRequest>(input: Input) => {
    const scoped = { ...input, root: this.getRoot() };
    const isTerminal = input.op.startsWith('terminal-');
    const queue = isTerminal ? this.terminalQueue : this.workspaceQueue;
    // 応答はサーバーと同じ契約から作られる。同一プロセスか loopback の中だけを通るので、ここでは検証しない。
    const result = queue.then(() => this.send(scoped)) as Promise<ResponseOf<Input['op']>>;
    if (isTerminal) this.terminalQueue = result.catch(() => undefined);
    else this.workspaceQueue = result.catch(() => undefined);
    return result;
  };
  async settle(): Promise<void> {
    await Promise.all([this.workspaceQueue, this.terminalQueue]);
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
