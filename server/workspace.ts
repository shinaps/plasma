import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { isSource } from '../shared/language.ts';
import { limits, megabytes } from '../shared/limits.ts';
import type {
  Diagnostic,
  DiskDocument,
  EmptyResult,
  Location,
  ResponseOf,
  WorkspaceInfo,
} from '../shared/protocol.ts';
import {
  byteOrderMark,
  decodeText,
  hasByteOrderMark,
  imageDataUrl,
  imageTooLarge,
  readBounded,
  textTooLarge,
} from './content.ts';
import { insideRoot, posixRelative } from './paths.ts';

type Project = {
  language: ts.LanguageService;
  /** tsconfig の include から決まる一覧。呼び出しごとに変えない。 */
  files: readonly string[];
  scope: string;
  /** include の外にあるファイルを開いたとき、そのファイルだけを一時的に加える。 */
  extra?: string;
};
type Overlay = { text: string; version: string };

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
// 言語サービスは要求のたびにプログラム内の全ファイル (lib や型定義を含む数百件) の版を問い合わせる。
// 本文を読んで hash を取ると要求ごとに十数 MB を読むので、ディスク上のファイルは更新時刻と大きさを版にする。
// 同じナノ秒の時刻で同じ大きさに書き換えられた変更は検知できない。
const diskVersion = (file: string): string => {
  const stat = fs.statSync(file, { bigint: true, throwIfNoEntry: false });
  return stat ? `${stat.mtimeNs}:${stat.size}` : 'missing';
};
const scriptFiles = (project: Project): string[] =>
  project.extra ? [...project.files, project.extra] : [...project.files];
// TS18003 "No inputs were found in config file" は公開 API に定数がないので番号で持つ。
const noInputsFoundCode = 18003;
// 依存や生成物のツリーはソースの構造を隠し、数百万ファイルを含むことがある。
const excludedDirectories = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.build',
  'DerivedData',
  '.next',
  '.turbo',
  '.cache',
  '.shinaps',
];

/** 1 つのプロジェクトのファイル操作と TypeScript の解析。要求で受け取った相対パスの境界検査はすべて resolve を通る。 */
export class Workspace {
  readonly root: string;
  private readonly overlays = new Map<string, Overlay>();
  private overlayVersion = 0;
  private readonly projects = new Map<string, Project>();
  private files: string[] = [];
  private directories: string[] = [];
  private unreadableDirectories: string[] = [];
  constructor(root: string) {
    this.root = fs.realpathSync.native(root);
    this.rescan();
  }

  dispose(): void {
    for (const project of this.projects.values()) project.language.dispose();
    this.projects.clear();
  }

  /** ファイルツリーを走査し直し、言語サービスも作り直す。設定ファイルの変更をここで取り込む。 */
  rescan(): WorkspaceInfo {
    this.dispose();
    this.files = [];
    this.directories = [];
    this.unreadableDirectories = [];
    const visit = (directory: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch (error) {
        // クラウド同期の未取得フォルダや権限のないフォルダがあっても、読めるソースは表示する。
        if (directory === this.root) throw error;
        this.unreadableDirectories.push(this.relative(directory));
        return;
      }
      for (const entry of entries) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory() && !excludedDirectories.includes(entry.name)) {
          this.directories.push(this.relative(file));
          visit(file);
        } else if (entry.isFile()) this.files.push(file);
      }
    };
    visit(this.root);
    return {
      name: path.basename(this.root),
      root: this.root,
      files: this.files.map((file) => this.relative(file)),
      directories: this.directories,
      unreadableDirectories: this.unreadableDirectories,
      typescript: ts.version,
    };
  }

  /** 相対パスをプロジェクト内の実体ファイルに解決する。UI と MCP が同じ境界を共有する (シンボリックリンクの実体も含む)。 */
  resolve(relative: string): string {
    // 存在しない・ディレクトリ・境界の外・NUL を含むなど、理由によらず 1 つの文言に倒す。
    // realpath は大小文字を実体に合わせる (native)。綴り違いの同じファイルが別の実体として扱われないため。
    try {
      const file = fs.realpathSync.native(path.resolve(this.root, relative));
      if (!path.isAbsolute(relative) && insideRoot(this.root, file) && fs.statSync(file).isFile())
        return file;
    } catch {
      // 下で同じ文言にする
    }
    throw new Error(`Not a file in this project: ${relative}`);
  }

  read(relative: string): DiskDocument {
    const file = this.resolve(relative);
    const text = this.diskText(file);
    return { path: this.relative(file), text, revision: hash(text) };
  }

  /**
   * @param revision read が返したディスク上の本文の hash。読み込み後にディスクが変わっていれば保存しない
   */
  save(relative: string, text: string, revision: string): DiskDocument {
    const file = this.resolve(relative);
    const bytes = readBounded(file, limits.textFile, textTooLarge);
    if (hash(decodeText(bytes)) !== revision)
      throw new Error('The file changed on disk. Copy your edits, then use Reload from disk.');
    this.checkTextSize(text);
    // 比較と書き込みの間に await を挟まないので、UI からの要求が割り込むことはない。
    // これは読み込み後の変更を検出する仕組みで、他のプロセスの書き込みを防ぐロックではない。
    // 本文は BOM 無しで扱うので、ディスクに BOM があったファイルには書き戻す。
    const encoded = Buffer.from(text, 'utf8');
    fs.writeFileSync(
      file,
      hasByteOrderMark(bytes) ? Buffer.concat([byteOrderMark, encoded]) : encoded,
    );
    this.overlays.delete(file);
    return this.read(relative);
  }

  discard(relative: string): DiskDocument {
    this.overlays.delete(this.resolve(relative));
    return this.read(relative);
  }

  /**
   * 編集中の本文の集合を置き換える。UI を閉じたり再読込したりしても、見えない未保存の本文が診断に残らない。
   * 本文が前回と同じ文書は版を引き継ぐ。版が変わると言語サービスがその文書を解析し直し、プログラム全体を作り直すため。
   */
  sync(documents: { path: string; text: string }[]): EmptyResult {
    const next = new Map<string, Overlay>();
    for (const document of documents) {
      // 外部で削除されたファイルの本文は解析できないので、残りの文書の同期を止めずに飛ばす。
      let file: string;
      try {
        file = this.resolve(document.path);
      } catch {
        continue;
      }
      this.checkTextSize(document.text);
      const kept = this.overlays.get(file);
      if (kept?.text === document.text) next.set(file, kept);
      else if (document.text !== this.diskTextIfReadable(file))
        next.set(file, { text: document.text, version: String(++this.overlayVersion) });
    }
    // 集合は最後にまとめて置き換える。途中で失敗しても半端な状態にならない。
    this.overlays.clear();
    for (const [file, overlay] of next) this.overlays.set(file, overlay);
    return {};
  }

  imageRead(relative: string): ResponseOf<'image-read'> {
    const file = this.resolve(relative);
    return { src: imageDataUrl(readBounded(file, limits.image, imageTooLarge), file) };
  }

  diagnostics(relative: string): ResponseOf<'diagnostics'> {
    if (!isSource(relative)) return { diagnostics: [], scope: null };
    const project = this.prepareProject(this.resolve(relative));
    // getProgram() は呼ぶたびに全ファイルの版を確かめ直す。1 回の要求で 1 回だけ取る。
    const program = project.language.getProgram();
    // 一覧を取った後に削除されたファイルは Program に無い。そのファイルの診断を求めると例外になる。
    const diagnostics = scriptFiles(project)
      .filter((file) => program?.getSourceFile(file))
      .flatMap((file) =>
        [
          ...project.language.getSyntacticDiagnostics(file),
          ...project.language.getSemanticDiagnostics(file),
        ].flatMap((diagnostic): Diagnostic[] => {
          const location = this.location(program, file, {
            start: diagnostic.start ?? 0,
            length: diagnostic.length ?? 0,
          });
          if (!location) return [];
          return [
            {
              ...location,
              message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
              code: diagnostic.code,
              severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
            },
          ];
        }),
      );
    return { diagnostics, scope: project.scope };
  }

  definition(relative: string, position: number): ResponseOf<'definition'> {
    const target = this.semantic(relative);
    if (!target) return { locations: [] };
    const definitions = target.language.getDefinitionAtPosition(target.file, position) ?? [];
    const program = target.language.getProgram();
    return {
      locations: definitions.flatMap(
        (definition) => this.location(program, definition.fileName, definition.textSpan) ?? [],
      ),
    };
  }

  references(relative: string, position: number): ResponseOf<'references'> {
    const target = this.semantic(relative);
    if (!target) return { locations: [] };
    const references = target.language.getReferencesAtPosition(target.file, position) ?? [];
    const program = target.language.getProgram();
    return {
      locations: references.flatMap(
        (reference) => this.location(program, reference.fileName, reference.textSpan) ?? [],
      ),
    };
  }

  hover(relative: string, position: number): ResponseOf<'hover'> {
    const target = this.semantic(relative);
    const info = target?.language.getQuickInfoAtPosition(target.file, position);
    if (!target || !info) return { info: null };
    return {
      info: {
        signature: ts.displayPartsToString(info.displayParts),
        documentation: ts.displayPartsToString(info.documentation),
        location: this.location(target.language.getProgram(), target.file, info.textSpan),
      },
    };
  }

  private semantic(relative: string): { language: ts.LanguageService; file: string } | undefined {
    if (!isSource(relative)) return undefined;
    const file = this.resolve(relative);
    return { language: this.prepareProject(file).language, file };
  }

  private checkTextSize(text: string): void {
    if (Buffer.byteLength(text) > limits.textFile)
      throw new Error(`Edits over ${megabytes(limits.textFile)} are not supported.`);
  }

  /** 編集中の本文との一致判定に使う。ディスク側が表示できない内容に変わっていれば、不一致として扱う。 */
  private diskTextIfReadable(file: string): string | undefined {
    try {
      return this.diskText(file);
    } catch {
      return undefined;
    }
  }

  /**
   * file に最も近い tsconfig.json のプロジェクトを返す。無ければ作ってキャッシュする。
   * include の外のファイルは、どの順番で呼ばれても同じ結果になるように、呼び出しごとに extra を差し替える。
   */
  private prepareProject(file: string): Project {
    let directory = path.dirname(file);
    while (directory !== this.root && !fs.existsSync(path.join(directory, 'tsconfig.json')))
      directory = path.dirname(directory);
    const project = this.projects.get(directory) ?? this.createProject(directory);
    project.extra = project.files.includes(file) ? undefined : file;
    return project;
  }

  private createProject(directory: string): Project {
    const configPath = path.join(directory, 'tsconfig.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error && fs.existsSync(configPath))
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(
      config.error
        ? {
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              jsx: 'react-jsx',
              allowJs: true,
              noEmit: true,
            },
            exclude: excludedDirectories,
          }
        : config.config,
      ts.sys,
      directory,
    );
    // include に一致するファイルがないだけなら解析は続けられる。開いたファイルを extra として加える。
    const errors = parsed.errors.filter((error) => error.code !== noInputsFoundCode);
    if (errors.length)
      throw new Error(
        errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'),
      );
    // tsconfig の files に存在しないファイルが書かれていても、あるファイルの解析は続ける。
    const realpath = (file: string): string | undefined => {
      try {
        return fs.realpathSync.native(file);
      } catch {
        return undefined;
      }
    };
    const files = parsed.fileNames.filter((file) => {
      const real = isSource(file) ? realpath(file) : undefined;
      return real !== undefined && insideRoot(this.root, real);
    });
    const project: Project = {
      files,
      scope: this.relative(configPath),
      language: ts.createLanguageService({
        getScriptFileNames: () => scriptFiles(project),
        getScriptVersion: (file) => this.overlays.get(file)?.version ?? diskVersion(file),
        getScriptSnapshot: (file) => {
          const text = this.text(file);
          return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
        },
        getCurrentDirectory: () => directory,
        getCompilationSettings: () => ({ ...parsed.options, noEmit: true }),
        getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
        realpath: ts.sys.realpath,
        useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      }),
    };
    this.projects.set(directory, project);
    return project;
  }

  /** ディスク上の本文。read と save の照合が同じ変換を通るように、ここだけで読む。 */
  private diskText(file: string): string {
    return decodeText(readBounded(file, limits.textFile, textTooLarge));
  }

  private text(file: string): string | undefined {
    return this.overlays.get(file)?.text ?? ts.sys.readFile(file);
  }

  private relative(file: string): string {
    return posixRelative(this.root, file);
  }

  /** プログラムが持つ構文木を使って位置を行と桁に変換する。プロジェクトの外のファイル (lib や依存) は null。 */
  private location(
    program: ts.Program | undefined,
    file: string,
    span: { start: number; length: number },
  ): Location | null {
    if (!insideRoot(this.root, file) || !isSource(file)) return null;
    const source = program?.getSourceFile(file);
    if (!source) return null;
    const start = source.getLineAndCharacterOfPosition(span.start);
    const end = source.getLineAndCharacterOfPosition(span.start + span.length);
    const lineStarts = source.getLineStarts();
    const lineEnd = lineStarts[start.line + 1] ?? source.text.length;
    return {
      path: this.relative(file),
      start: span.start,
      length: span.length,
      line: start.line + 1,
      column: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
      preview: source.text.slice(lineStarts[start.line], lineEnd).trim(),
    };
  }
}
