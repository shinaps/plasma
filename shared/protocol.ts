import { z } from 'zod';
import { type Appearance, appearanceSchema } from './appearance.ts';
import { limits } from './limits.ts';

// クライアントとサーバーの契約。入力は zod で検証し、応答は同一プロセスか loopback の中だけを通るので型だけで表す。

const root = z.string();
const relativePath = z.string();
const position = z.number().int().nonnegative();
export const formatterIdSchema = z.enum(['auto', 'vite-plus', 'biome', 'oxfmt']);
export type FormatterId = z.infer<typeof formatterIdSchema>;

// Connection は常に root を付けて送る。root を使わない op では、z.object が定義にないキーとして root を取り除く。
const projectVariants = [
  z.object({ op: z.literal('appearance-get') }),
  z.object({ op: z.literal('appearance-set'), appearance: appearanceSchema }),
  z.object({ op: z.literal('project-list') }),
  z.object({ op: z.literal('project-pick') }),
  z.object({ op: z.literal('project-browse'), path: z.string().optional() }),
  z.object({
    op: z.literal('project-open'),
    path: z.string().trim().min(1, 'Enter a folder path.'),
    confirmedRoot: z.string().optional(),
  }),
  z.object({ op: z.literal('project-forget'), path: z.string() }),
  z.object({ op: z.literal('settings-get'), root }),
  z.object({
    op: z.literal('settings-set'),
    root,
    formatOnSave: z.boolean().optional(),
    excludedPaths: z.array(z.string().trim().min(1)).optional(),
    analysisExcludedPaths: z.array(z.string().trim().min(1)).optional(),
    formatter: formatterIdSchema.optional(),
  }),
] as const;
const workspaceVariants = [
  z.object({
    op: z.literal('workspace'),
    root,
    expanded: z.array(z.string()).optional(),
    recursive: z.string().optional(),
  }),
  z.object({ op: z.literal('workspace-revision'), root }),
  z.object({ op: z.literal('read'), root, path: relativePath }),
  z.object({ op: z.literal('file-create'), root, path: relativePath, directory: z.boolean() }),
  z.object({
    op: z.literal('file-transfer'),
    root,
    path: relativePath,
    destination: relativePath,
    move: z.boolean(),
  }),
  z.object({ op: z.literal('file-delete'), root, path: relativePath }),
  z.object({
    op: z.literal('save'),
    root,
    path: relativePath,
    text: z.string(),
    revision: z.string(),
  }),
  z.object({ op: z.literal('discard'), root, path: relativePath }),
  z.object({
    op: z.literal('sync'),
    root,
    documents: z.array(z.object({ path: relativePath, text: z.string() })),
  }),
  z.object({
    op: z.literal('outline'),
    root,
    path: relativePath,
    text: z.string().max(2 * 1024 * 1024),
  }),
  z.object({ op: z.literal('diagnostics'), root, path: relativePath }),
  z.object({ op: z.literal('definition'), root, path: relativePath, position }),
  z.object({ op: z.literal('references'), root, path: relativePath, position }),
  z.object({ op: z.literal('hover'), root, path: relativePath, position }),
  z.object({ op: z.literal('image-read'), root, path: relativePath }),
  z.object({ op: z.literal('git-pr-list'), root }),
  z.object({ op: z.literal('git-pr-open'), root, number: z.number().int().positive() }),
  z.object({ op: z.literal('git-pr-diff'), root, id: z.string(), path: relativePath }),
  z.object({ op: z.literal('git-status'), root }),
  z.object({ op: z.literal('git-branches'), root }),
  z.object({ op: z.literal('git-switch'), root, branch: z.string().min(1) }),
  z.object({
    op: z.literal('git-commit-files'),
    root,
    paths: z.array(z.string()).min(1),
    partial: z
      .array(
        z.object({
          path: relativePath,
          before: z.string(),
          after: z.string(),
          changes: z.array(z.number().int().nonnegative()).min(1),
        }),
      )
      .default([]),
    message: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal('git-history'),
    root,
    revisions: z.array(z.string()).max(64).default([]),
    compareRef: z.string().optional(),
    compareTip: z.string().optional(),
    query: z.string().max(limits.historyQuery).default(''),
    skip: z.number().int().nonnegative().default(0),
  }),
  z.object({ op: z.literal('git-commit'), root, ref: z.string() }),
  z.object({ op: z.literal('git-commit-diff'), root, ref: z.string(), path: relativePath }),
  z.object({
    op: z.literal('git-diff'),
    root,
    path: relativePath,
    mode: z.enum(['all', 'working', 'staged']).default('all'),
  }),
] as const;
const terminalVariants = [
  z.object({ op: z.literal('terminal-start'), root }),
  z.object({ op: z.literal('terminal-list'), root }),
  z.object({ op: z.literal('terminal-close'), root, id: z.string() }),
  z.object({
    op: z.literal('terminal-read'),
    root,
    id: z.string(),
    cursor: z.number().int().nonnegative().default(0),
  }),
  z.object({
    op: z.literal('terminal-write'),
    root,
    id: z.string(),
    text: z.string().max(limits.terminalWrite),
  }),
  z.object({
    op: z.literal('terminal-resize'),
    root,
    id: z.string(),
    cols: z.number().int(),
    rows: z.number().int(),
  }),
] as const;

export const requestSchema = z.discriminatedUnion('op', [
  ...projectVariants,
  ...workspaceVariants,
  ...terminalVariants,
]);
const opsOf = (variants: readonly { shape: { op: { value: string } } }[]): string[] =>
  variants.map((variant) => variant.shape.op.value);
/** MCP のツール定義で op を列挙するための一覧。入力全体の検証は requestSchema が行う。 */
export const workbenchOps = [...opsOf(projectVariants), ...opsOf(workspaceVariants)];
export const terminalOps = opsOf(terminalVariants);

/** 検証前の入力の形。root を含む。 */
export type RequestInput = z.input<typeof requestSchema>;
/** サーバー側の入力 (default 適用後)。 */
export type ParsedRequest = z.output<typeof requestSchema>;
export type RequestOp = ParsedRequest['op'];
export type DiffMode = Extract<ParsedRequest, { op: 'git-diff' }>['mode'];
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** クライアント側の入力 (default 適用前、root なし)。 */
export type ClientRequest = DistributiveOmit<RequestInput, 'root'>;

export type EmptyResult = Record<string, never>;
export type RecentProject = { root: string; name: string };
export type ProjectSettings = {
  formatOnSave: boolean;
  formatter: FormatterId;
  excludedPaths: string[];
  analysisExcludedPaths: string[];
};
export type FormatterInfo = { id: FormatterId; name: string; version: string };
export type FormatterStatus = { available: FormatterInfo[]; active: FormatterInfo | null };
export type SettingsView = ProjectSettings & FormatterStatus;
export type WorkspaceInfo = {
  symlinks: Record<string, string>;
  revision: number;
  analysisExcludedPaths: string[];
  name: string;
  root: string;
  files: string[];
  directories: string[];
  unreadableDirectories: string[];
  typescript: string;
};
export type DiskDocument = { path: string; text: string; revision: string; warning?: string };
export type Location = {
  path: string;
  start: number;
  length: number;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  preview: string;
};
export type Diagnostic = Location & {
  message: string;
  code: number;
  severity: 'error' | 'warning';
};
export type HoverResult = {
  info: { signature: string; documentation: string; location: Location | null } | null;
};
export type GitKind = 'untracked' | 'conflict' | 'deleted' | 'added' | 'modified';
export type GitEntry = {
  path: string;
  repoPath: string;
  oldPath?: string;
  index: string;
  working: string;
  kind: GitKind;
};
export type GitStatus = {
  available: boolean;
  branch: string;
  entries: GitEntry[];
  ignoredPaths: string[];
};
/** Git リポジトリでない、またはまだ取得していない状態。 */
export const emptyGitStatus = (): GitStatus => ({
  available: false,
  branch: '',
  entries: [],
  ignoredPaths: [],
});
export type HistoryCommit = {
  id: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  decorations: string;
  outsideBase?: boolean;
};
export type GitHistory = {
  refs: string[];
  selection: string[];
  /** 指定されたが存在しない参照 (削除されたブランチなど)。選択から外して残りの履歴を返す。 */
  missing: string[];
  tips: string[];
  comparison?: { ref: string; tip: string; outsideCount: number };
  commits: HistoryCommit[];
  hasMore: boolean;
};
export type CommitDetail = {
  id: string;
  parent?: string;
  author: string;
  date: string;
  message: string;
  entries: GitEntry[];
};
export type PullRequest = {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  base: string;
  head: string;
};
export type PullRequestComparison = PullRequest & {
  id: string;
  repositoryRoot: string;
  baseCommit: string;
  headCommit: string;
  entries: GitEntry[];
};
export type DiffView = {
  path: string;
  originalExists: boolean;
  original: string;
  modified: string;
  originalLabel: string;
  originalPath?: string;
  modifiedLabel: string;
  image: boolean;
  editable: boolean;
  /** 作業ツリーに同じパスのファイルがあるか。無ければ「Open Working File」を出さない */
  inWorkingTree: boolean;
};
export type TerminalSession = { id: string; title: string; exitCode: number | null };
export type TerminalOutput = {
  data: string;
  cursor: number;
  truncated: boolean;
  exitCode: number | null;
};

type ResponseMap = {
  'appearance-get': Appearance;
  'appearance-set': Appearance;
  'project-list': { recent: RecentProject[]; home: string };
  'project-pick': { path: string | null; supported: boolean };
  'project-browse': { root: string; parent: string; folders: { name: string; path: string }[] };
  'project-open': { root: string; confirmationRequired?: true };
  'project-forget': { recent: RecentProject[] };
  'settings-get': SettingsView;
  'settings-set': SettingsView;
  workspace: WorkspaceInfo;
  'workspace-revision': { revision: number };
  read: DiskDocument;
  'file-create': { path: string };
  'file-transfer': { path: string };
  'file-delete': EmptyResult;
  save: DiskDocument;
  discard: DiskDocument;
  sync: EmptyResult;
  diagnostics: { diagnostics: Diagnostic[]; scope: string | null };
  definition: { locations: Location[] };
  references: { locations: Location[] };
  hover: HoverResult;
  'image-read': { src: string };
  'git-pr-list': { repository: string; requests: PullRequest[] };
  'git-pr-open': PullRequestComparison;
  'git-pr-diff': DiffView;
  'git-status': GitStatus;
  'git-branches': { branches: string[] };
  'git-switch': { branch: string };
  outline: { symbols: OutlineSymbol[] };
  'git-commit-files': { hash: string };
  'git-history': GitHistory;
  'git-commit': CommitDetail;
  'git-commit-diff': DiffView;
  'git-diff': DiffView;
  'terminal-start': TerminalSession;
  'terminal-list': { sessions: TerminalSession[] };
  'terminal-close': { warning?: string };
  'terminal-read': TerminalOutput;
  'terminal-write': EmptyResult;
  'terminal-resize': EmptyResult;
};
export type ResponseOf<Op extends RequestOp> = ResponseMap[Op];
export type DispatchResult = ResponseMap[RequestOp];
/** 入力の op から応答の型が決まる。root は Connection が付けるので呼び出し側は書かない。 */
export type SendRequest = <Input extends ClientRequest>(
  input: Input,
) => Promise<ResponseOf<Input['op']>>;
export const errorResponseSchema = z.object({ error: z.string() });

export type OutlineSymbol = {
  name: string;
  kind: 'class' | 'type' | 'function';
  start: number;
  end: number;
  depth: number;
};

export type PartialSelection = { path: string; before: string; after: string; changes: number[] };
