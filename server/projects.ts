import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { isSource } from '../shared/language.ts';
import {
  type DiskDocument,
  type DispatchResult,
  type FormatterId,
  type ParsedRequest,
  type RecentProject,
  type RequestInput,
  type RequestOp,
  type ResponseOf,
  requestSchema,
} from '../shared/protocol.ts';
import { formatDocument, formatterStatus } from './formatting.ts';
import { gitDiff, gitStatus } from './git.ts';
import { gitCommit, gitCommitDiff, gitHistory } from './git-history.ts';
import { StateStore } from './state-store.ts';
import { ShellTerminal } from './terminal.ts';
import { Workspace } from './workspace.ts';

type OpenedProject = { workspace: Workspace; terminal: ShellTerminal };
type ProjectRequest = Extract<ParsedRequest, { root: string }>;
/** 最近開いた一覧に残す件数。プロジェクト選択画面に収まる量。 */
const recentLimit = 12;

/** 開いているプロジェクトの集合。HTTP / MCP の両方から届く要求を op ごとの処理に振り分けるのはこのクラスだけ。 */
export class Projects {
  private readonly state: StateStore;
  private readonly home: string;
  private readonly opened = new Map<string, OpenedProject>();
  /**
   * @param options.directory 設定の保存先。省略時は環境変数 WORKBENCH_STATE_DIR、それも無ければ ~/.config/typescript-workbench
   * @param options.home 「~」の展開と広すぎるフォルダの判定に使うホーム。テストでは一時ディレクトリを渡す
   */
  constructor(options: { directory?: string; home?: string } = {}) {
    this.home = options.home ?? os.homedir();
    // 保存先と環境変数は旧名 typescript-workbench のまま使う。既存の利用者の設定を引き継ぐため。
    this.state = new StateStore(
      options.directory ??
        process.env.WORKBENCH_STATE_DIR ??
        path.join(this.home, '.config', 'typescript-workbench'),
    );
  }

  /** 入力の形が分かっているとき (テストや MCP の open_workbench) は、op から応答の型が決まる。 */
  dispatch<Input extends RequestInput>(input: Input): Promise<ResponseOf<Input['op'] & RequestOp>>;
  dispatch(raw: unknown): Promise<DispatchResult>;
  async dispatch(raw: unknown): Promise<DispatchResult> {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
    const input = parsed.data;
    switch (input.op) {
      case 'appearance-get':
        return this.state.readAppearance();
      case 'appearance-set':
        this.state.writeAppearance(input.appearance);
        return input.appearance;
      case 'project-list':
        return { recent: this.recent(), home: this.home };
      case 'project-forget': {
        const recent = this.recent().filter((project) => project.root !== input.path);
        this.state.writeRecent(recent);
        return { recent };
      }
      case 'project-browse': {
        const root = fs.realpathSync.native(this.expand(input.path || this.home));
        const folders = fs
          .readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => ({ name: entry.name, path: path.join(root, entry.name) }))
          .sort((left, right) => left.name.localeCompare(right.name));
        return { root, parent: path.dirname(root), folders };
      }
      case 'project-open':
        return this.open(input.path, input.confirmedRoot);
      default:
        return this.dispatchToProject(input);
    }
  }

  private async dispatchToProject(input: ProjectRequest): Promise<DispatchResult> {
    const project = this.opened.get(input.root);
    if (!project) throw new Error('Open a project from the start screen first.');
    const { workspace, terminal } = project;
    switch (input.op) {
      case 'settings-get': {
        const settings = this.state.readSettings(input.root);
        return { ...settings, ...formatterStatus(input.root, settings.formatter) };
      }
      case 'settings-set': {
        const settings = {
          formatOnSave: input.formatOnSave,
          formatter: input.formatter ?? this.state.readSettings(input.root).formatter,
        };
        this.state.writeSettings(input.root, settings);
        return { ...settings, ...formatterStatus(input.root, settings.formatter) };
      }
      case 'workspace':
        return workspace.rescan();
      case 'read':
        return workspace.read(input.path);
      case 'save': {
        const settings = this.state.readSettings(input.root);
        return settings.formatOnSave && isSource(input.path)
          ? this.formattedSave(
              workspace,
              input.path,
              input.text,
              input.revision,
              settings.formatter,
            )
          : workspace.save(input.path, input.text, input.revision);
      }
      case 'discard':
        return workspace.discard(input.path);
      case 'sync':
        return workspace.sync(input.documents);
      case 'diagnostics':
        return workspace.diagnostics(input.path);
      case 'definition':
        return workspace.definition(input.path, input.position);
      case 'references':
        return workspace.references(input.path, input.position);
      case 'hover':
        return workspace.hover(input.path, input.position);
      case 'image-read':
        return workspace.imageRead(input.path);
      case 'git-status':
        return gitStatus(workspace.root);
      case 'git-history':
        return gitHistory(workspace.root, input);
      case 'git-commit':
        return gitCommit(workspace.root, input.ref);
      case 'git-commit-diff':
        return gitCommitDiff(workspace.root, input.ref, input.path);
      case 'git-diff':
        return gitDiff(workspace, input.path, input.mode);
      case 'terminal-start':
        return terminal.start();
      case 'terminal-list':
        return terminal.list();
      case 'terminal-close':
        return terminal.close(input.id);
      case 'terminal-read':
        return terminal.read(input.id, input.cursor);
      case 'terminal-write':
        return terminal.write(input.id, input.text);
      case 'terminal-resize':
        return terminal.resize(input.id, input.cols, input.rows);
      default: {
        const unreachable: never = input;
        throw new Error(`Unsupported operation: ${JSON.stringify(unreachable)}`);
      }
    }
  }

  private open(requested: string, confirmedRoot?: string): ResponseOf<'project-open'> {
    const root = fs.realpathSync.native(this.expand(requested));
    if (!fs.statSync(root).isDirectory()) throw new Error('Select a folder.');
    // ホームが無い環境では「広すぎる」判定が一致しないだけで、開く操作は続ける。
    const home = this.realHome();
    // ホームやディスク直下のように広すぎるフォルダは、ワークスペースを作る前に確認を求める。
    const broad =
      home === root ||
      home.startsWith(`${root}${path.sep}`) ||
      path.dirname(root) === path.parse(root).root;
    if (broad && confirmedRoot !== root) return { root, confirmationRequired: true };
    // 一覧の保存に失敗したら開かない。開いた後で失敗すると、一覧に無いプロジェクトが開いたままになる。
    this.state.writeRecent(
      [
        { root, name: path.basename(root) },
        ...this.recent().filter((project) => project.root !== root),
      ].slice(0, recentLimit),
    );
    if (!this.opened.has(root))
      this.opened.set(root, { workspace: new Workspace(root), terminal: new ShellTerminal(root) });
    return { root };
  }

  private recent(): RecentProject[] {
    return this.state.readRecent().filter(({ root }) => {
      try {
        return fs.statSync(root).isDirectory();
      } catch {
        return false;
      }
    });
  }

  private async formattedSave(
    workspace: Workspace,
    relative: string,
    text: string,
    revision: string,
    formatter: FormatterId,
  ): Promise<DiskDocument> {
    const formatted = await formatDocument(
      workspace.root,
      workspace.resolve(relative),
      text,
      formatter,
    );
    // 整形が終わってからリビジョンを照合する。整形中に外部で変わっていれば保存しない。
    return { ...workspace.save(relative, formatted.text, revision), warning: formatted.warning };
  }

  private realHome(): string {
    try {
      return fs.realpathSync.native(this.home);
    } catch {
      return this.home;
    }
  }

  private expand(value: string): string {
    return value === '~'
      ? this.home
      : value.startsWith('~/')
        ? path.join(this.home, value.slice(2))
        : path.resolve(value);
  }

  dispose(): void {
    for (const { workspace, terminal } of this.opened.values()) {
      terminal.dispose();
      workspace.dispose();
    }
    this.opened.clear();
  }
}
