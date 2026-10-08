import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { type Appearance, appearanceSchema } from '../shared/appearance.ts';
import { errorCode, errorMessage } from '../shared/errors.ts';
import { defaultAnalysisExcludedPaths, defaultExcludedPaths } from '../shared/explorer-settings.ts';
import { formatterIdSchema, type ProjectSettings, type RecentProject } from '../shared/protocol.ts';

const recentProjectsSchema = z.array(z.object({ root: z.string(), name: z.string() }));
const projectSettingsSchema = z.object({
  formatOnSave: z.boolean().default(false),
  formatter: formatterIdSchema.default('auto'),
  excludedPaths: z.array(z.string()).default(defaultExcludedPaths),
  analysisExcludedPaths: z.array(z.string()).default(defaultAnalysisExcludedPaths),
});

/** 設定ファイルが無ければ undefined。壊れていれば、直すべきファイルが分かるエラーにする。 */
function readJsonFile<Schema extends z.ZodType>(
  file: string,
  schema: Schema,
): z.output<Schema> | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    const reason = error instanceof z.ZodError ? z.prettifyError(error) : errorMessage(error);
    throw new Error(`Cannot read ${file}: ${reason}. Fix or delete the file.`, { cause: error });
  }
}

/** 一時ファイルに書いてから置き換えるので、途中で止まっても元のファイルは壊れない。 */
function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** アプリ全体の設定とプロジェクトごとの設定を、ユーザーの設定ディレクトリに保存する。 */
export class StateStore {
  private readonly recentFile: string;
  private readonly appearanceFile: string;
  private readonly settingsDirectory: string;
  constructor(directory: string) {
    this.recentFile = path.join(directory, 'projects.json');
    this.appearanceFile = path.join(directory, 'appearance.json');
    this.settingsDirectory = path.join(directory, 'settings');
  }
  readRecent(): RecentProject[] {
    return readJsonFile(this.recentFile, recentProjectsSchema) ?? [];
  }
  writeRecent(recent: RecentProject[]): void {
    writeJsonAtomic(this.recentFile, recent);
  }
  readAppearance(): Appearance {
    return readJsonFile(this.appearanceFile, appearanceSchema) ?? {};
  }
  writeAppearance(value: Appearance): void {
    writeJsonAtomic(this.appearanceFile, value);
  }
  readSettings(root: string): ProjectSettings {
    return (
      readJsonFile(this.settingsFile(root), projectSettingsSchema) ??
      projectSettingsSchema.parse({})
    );
  }
  /**
   * 壊れた設定ファイルでも既定値で続ける読み方。文書の保存を設定の破損で止めないために使う。
   * ファイルは上書きしない。利用者が直すか消すまで warning で知らせる。
   */
  readSettingsOrDefault(root: string): { settings: ProjectSettings; warning?: string } {
    try {
      return { settings: this.readSettings(root) };
    } catch (error) {
      return { settings: projectSettingsSchema.parse({}), warning: errorMessage(error) };
    }
  }
  writeSettings(root: string, settings: ProjectSettings): void {
    writeJsonAtomic(this.settingsFile(root), settings);
  }
  private settingsFile(root: string): string {
    return path.join(
      this.settingsDirectory,
      `${createHash('sha256').update(root).digest('hex')}.json`,
    );
  }
}
