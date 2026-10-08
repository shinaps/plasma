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
import { createEntry, deleteEntry, transferEntry } from './file-operations.ts';
import { pickFolder } from './folder-picker.ts';
import { formatDocument, formatterStatus } from './formatting.ts';
import { commitFiles, gitBranches, gitDiff, gitStatus, switchBranch } from './git.ts';
import { gitCommit, gitCommitDiff, gitHistory } from './git-history.ts';
import { outline } from './outline.ts';
import { commitSelection } from './partial-commit.ts';
import { listPullRequests, openPullRequest, pullRequestDiff } from './pull-requests.ts';
import { StateStore } from './state-store.ts';
import { ShellTerminal, type SpawnShell } from './terminal.ts';
import { Workspace } from './workspace.ts';

/**
 * 開いたプロジェクト。ターミナルはタブを閉じるまで保持する。ワークスペース (監視と言語サービス) は
 * しばらく使われなければ解放し、次の要求で作り直す。
 */
type OpenedProject = { workspace?: Workspace; terminal: ShellTerminal; lastUsed: number };
type ProjectRequest = Extract<ParsedRequest, { root: string }>;
type ProjectOp = ProjectRequest['op'];
type ProjectContext = { root: string; workspace: Workspace; terminal: ShellTerminal };
/** op ごとの処理。応答の型が op から決まるので、別の op の応答を返す実装は型検査で止まる。 */
export type ProjectHandlers = {
  [Op in ProjectOp]: (
    input: Extract<ProjectRequest, { op: Op }>,
    context: ProjectContext,
  ) => ResponseOf<Op> | Promise<ResponseOf<Op>>;
};
/** 最近開いた一覧に残す件数。プロジェクト選択画面に収まる量。 */
const recentLimit = 12;
/** 使われていないワークスペースを解放するまでの時間。言語サービスの保持量を、開いたままのプロジェクトで増やし続けない。 */
const idleRelease = 15 * 60 * 1000;

/** 開いているプロジェクトの集合。HTTP / MCP の両方から届く要求を op ごとの処理に振り分けるのはこのクラスだけ。 */
export class Projects {
  private readonly state: StateStore;
  private readonly home: string;
  private readonly spawnShell?: SpawnShell;
  private readonly opened = new Map<string, OpenedProject>();
  private readonly releaseTimer: ReturnType<typeof setInterval>;
  /**
   * @param options.directory 設定の保存先。省略時は環境変数 WORKBENCH_STATE_DIR、それも無ければ ~/.config/typescript-workbench
   * @param options.home 「~」の展開と広すぎるフォルダの判定に使うホーム。テストでは一時ディレクトリを渡す
   * @param options.spawnShell ターミナルのシェルの起動方法。テストではログインシェルを起動しない
   * @param options.idleRelease ワークスペースを解放するまでの未使用時間 (ミリ秒)
   */
  constructor(
    options: {
      directory?: string;
      home?: string;
      spawnShell?: SpawnShell;
      idleRelease?: number;
    } = {},
  ) {
    this.home = options.home ?? os.homedir();
    this.spawnShell = options.spawnShell;
    // 保存先と環境変数は旧名 typescript-workbench のまま使う。既存の利用者の設定を引き継ぐため。
    this.state = new StateStore(
      options.directory ??
        process.env.WORKBENCH_STATE_DIR ??
        path.join(this.home, '.config', 'typescript-workbench'),
    );
    const idle = options.idleRelease ?? idleRelease;
    this.releaseTimer = setInterval(() => this.releaseIdle(idle), Math.min(idle, 60_000));
    this.releaseTimer.unref();
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
      case 'project-pick':
        return pickFolder();
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
    if (!project)
      throw new Error(
        'The project is no longer open on the server. Return to projects and reopen it.',
      );
    project.lastUsed = Date.now();
    project.workspace ??= this.createWorkspace(input.root);
    const context = { root: input.root, workspace: project.workspace, terminal: project.terminal };
    // 入力の op と handler の op は同じ。Extract 同士の対応を TypeScript は配列の添字では追えないので、ここだけ never で渡す。
    const handler = this.handlers[input.op] as (
      input: ProjectRequest,
      context: ProjectContext,
    ) => DispatchResult | Promise<DispatchResult>;
    return handler(input, context);
  }

  private readonly handlers: ProjectHandlers = {
    'settings-get': (input) => {
      const settings = this.state.readSettings(input.root);
      return { ...settings, ...formatterStatus(input.root, settings.formatter) };
    },
    'settings-set': (input) => {
      const previous = this.state.readSettings(input.root);
      const settings = {
        formatOnSave: input.formatOnSave ?? previous.formatOnSave,
        formatter: input.formatter ?? previous.formatter,
        excludedPaths: input.excludedPaths ?? previous.excludedPaths,
        analysisExcludedPaths: input.analysisExcludedPaths ?? previous.analysisExcludedPaths,
      };
      this.state.writeSettings(input.root, settings);
      return { ...settings, ...formatterStatus(input.root, settings.formatter) };
    },
    'workspace-revision': (_input, { workspace }) => ({ revision: workspace.revision }),
    workspace: (input, { workspace }) => {
      const settings = this.state.readSettings(input.root);
      return workspace.rescan(
        settings.excludedPaths,
        settings.analysisExcludedPaths,
        input.expanded ?? [],
        input.recursive,
      );
    },
    'file-create': (input, { workspace }) =>
      createEntry(workspace.root, input.path, input.directory),
    'file-transfer': (input, { workspace }) =>
      transferEntry(workspace.root, input.path, input.destination, input.move),
    'file-delete': (input, { workspace }) => deleteEntry(workspace.root, input.path),
    read: (input, { workspace }) => workspace.read(input.path),
    save: (input, { workspace }) => {
      // 設定ファイルが壊れていても文書の保存は止めない。整形だけを省き、warning で設定の修復を促す。
      const { settings, warning } = this.state.readSettingsOrDefault(input.root);
      if (warning) {
        return {
          ...workspace.save(input.path, input.text, input.revision),
          warning: `Saved without formatting. ${warning}`,
        };
      }
      return settings.formatOnSave && isSource(input.path)
        ? this.formattedSave(workspace, input.path, input.text, input.revision, settings.formatter)
        : workspace.save(input.path, input.text, input.revision);
    },
    discard: (input, { workspace }) => workspace.discard(input.path),
    sync: (input, { workspace }) => workspace.sync(input.documents),
    outline: (input) => ({ symbols: outline(input.path, input.text) }),
    diagnostics: (input, { workspace }) => workspace.diagnostics(input.path),
    definition: (input, { workspace }) => workspace.definition(input.path, input.position),
    references: (input, { workspace }) => workspace.references(input.path, input.position),
    hover: (input, { workspace }) => workspace.hover(input.path, input.position),
    'image-read': (input, { workspace }) => workspace.imageRead(input.path),
    'git-commit-files': (input, { workspace }) =>
      input.partial.length
        ? commitSelection(workspace.root, input.paths, input.message, input.partial)
        : commitFiles(workspace.root, input.paths, input.message),
    'git-branches': (_input, { workspace }) => gitBranches(workspace.root),
    'git-switch': (input, { workspace }) => switchBranch(workspace.root, input.branch),
    'git-pr-list': (_input, { workspace }) => listPullRequests(workspace.root),
    'git-pr-open': (input, { workspace }) => openPullRequest(workspace.root, input.number),
    'git-pr-diff': (input, { workspace }) => pullRequestDiff(workspace.root, input.id, input.path),
    'git-status': (_input, { workspace }) => gitStatus(workspace.root, workspace.visiblePaths()),
    'git-history': (input, { workspace }) => gitHistory(workspace.root, input),
    'git-commit': (input, { workspace }) => gitCommit(workspace.root, input.ref),
    'git-commit-diff': (input, { workspace }) =>
      gitCommitDiff(workspace.root, input.ref, input.path),
    'git-diff': (input, { workspace }) => gitDiff(workspace, input.path, input.mode),
    'terminal-start': (_input, { terminal }) => terminal.start(),
    'terminal-list': (_input, { terminal }) => terminal.list(),
    'terminal-close': (input, { terminal }) => terminal.close(input.id),
    'terminal-read': (input, { terminal }) => terminal.read(input.id, input.cursor),
    'terminal-write': (input, { terminal }) => terminal.write(input.id, input.text),
    'terminal-resize': (input, { terminal }) => terminal.resize(input.id, input.cols, input.rows),
  };

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
    const project = this.opened.get(root);
    if (project) {
      project.lastUsed = Date.now();
      project.workspace ??= this.createWorkspace(root);
    } else {
      this.opened.set(root, {
        workspace: this.createWorkspace(root),
        terminal: new ShellTerminal(root, this.spawnShell),
        lastUsed: Date.now(),
      });
    }
    return { root };
  }

  private createWorkspace(root: string): Workspace {
    const settings = this.state.readSettings(root);
    return new Workspace(root, settings.excludedPaths, settings.analysisExcludedPaths);
  }

  /** 使われていないワークスペースを解放する。ターミナルのシェルは利用者が閉じるまで残す。 */
  private releaseIdle(idle: number): void {
    const now = Date.now();
    for (const project of this.opened.values()) {
      if (!project.workspace || now - project.lastUsed < idle) continue;
      project.workspace.dispose();
      project.workspace = undefined;
    }
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
    clearInterval(this.releaseTimer);
    for (const { workspace, terminal } of this.opened.values()) {
      terminal.dispose();
      workspace?.dispose();
    }
    this.opened.clear();
  }
}
