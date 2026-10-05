import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { z } from 'zod';
import { limits } from '../shared/limits.ts';
import type { FormatterId, FormatterInfo, FormatterStatus } from '../shared/protocol.ts';

type ProviderId = Exclude<FormatterId, 'auto'>;
type Provider = {
  id: ProviderId;
  name: string;
  package: string;
  bin: string;
  args: (file: string) => string[];
};
type Detected = Provider & { version: string; binPath: string };

// 整形器を見つける順番。Vite+ は同梱の整形器 (oxfmt) をプロジェクト設定込みで呼ぶので、単体の oxfmt より先に使う。
const providers: Provider[] = [
  {
    id: 'vite-plus',
    name: 'Vite+',
    package: 'vite-plus',
    bin: 'vp',
    args: (file) => ['fmt', `--stdin-filepath=${file}`],
  },
  {
    id: 'biome',
    name: 'Biome',
    package: '@biomejs/biome',
    bin: 'biome',
    args: (file) => ['format', `--stdin-file-path=${file}`, '--files-ignore-unknown=true'],
  },
  {
    id: 'oxfmt',
    name: 'Oxfmt',
    package: 'oxfmt',
    bin: 'oxfmt',
    args: (file) => [`--stdin-filepath=${file}`],
  },
];
/** 整形器が応答しないときに保存を止めないための上限。大きなファイルの整形でも通常は 1 秒以内に終わる。 */
const formatterTimeout = 10_000;
/** 整形結果の上限。保存できる本文の上限と同じ。超えた結果は保存できないので、整形しなかったものとして扱う。 */
const formatterOutputLimit = limits.textFile;
/** 警告に添える整形器のエラー出力の長さ。通知欄に収まり、原因の先頭が読める量。 */
const formatterErrorExcerpt = 1200;
// package.json の bin は 1 つのコマンドなら文字列、複数なら表になる。
const manifestSchema = z.object({
  version: z.string(),
  bin: z.union([z.string(), z.record(z.string(), z.string())]),
});

function detectFormatters(root: string): Detected[] {
  const require = createRequire(path.join(root, 'package.json'));
  return providers.flatMap((provider) => {
    try {
      const manifestPath = require.resolve(`${provider.package}/package.json`);
      const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[provider.bin];
      if (!bin) return [];
      return [
        {
          ...provider,
          version: manifest.version,
          binPath: path.resolve(path.dirname(manifestPath), bin),
        },
      ];
    } catch {
      return [];
    }
  });
}

function select(available: Detected[], selected: FormatterId): Detected | undefined {
  return selected === 'auto'
    ? available[0]
    : available.find((provider) => provider.id === selected);
}

export function formatterStatus(root: string, selected: FormatterId): FormatterStatus {
  const detected = detectFormatters(root);
  const info = ({ id, name, version }: Detected): FormatterInfo => ({ id, name, version });
  const active = select(detected, selected);
  return { available: detected.map(info), active: active ? info(active) : null };
}

/**
 * プロジェクトにある整形器で本文を整形する。整形できないときは本文をそのまま返し、理由を warning に入れる。
 * @param root 整形器を探すプロジェクトのルート
 * @param file 整形器に渡す絶対パス。拡張子から言語を判定するためだけに使う
 * @param text 整形する本文
 * @param selected 設定で選ばれた整形器。auto なら見つかった最初のもの
 */
export async function formatDocument(
  root: string,
  file: string,
  text: string,
  selected: FormatterId,
): Promise<{ text: string; warning?: string }> {
  const formatter = select(detectFormatters(root), selected);
  if (!formatter) return { text, warning: 'No formatter found; saved without formatting.' };
  return new Promise((resolve) => {
    // 標準入力で渡すので、リビジョン照合つきの保存が成功するまでディスク上のファイルは変わらない。
    const child = execFile(
      process.execPath,
      [formatter.binPath, ...formatter.args(file)],
      { cwd: root, timeout: formatterTimeout, maxBuffer: formatterOutputLimit, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          // タイムアウトは killed、出力の超過は maxBuffer のエラー。どちらも整形器の標準エラー出力は無い。
          const reason = error.killed
            ? `timed out after ${formatterTimeout / 1000} s`
            : (stderr || error.message).trim().slice(0, formatterErrorExcerpt);
          resolve({
            text,
            warning: `${formatter.name} could not be applied; saved without formatting.\n${reason}`,
          });
        }
        // 標準入力を読まずに正常終了した整形器は空の出力を返す。それを整形結果として保存すると本文が消える。
        else if (!stdout && text)
          resolve({
            text,
            warning: `${formatter.name} produced no output; saved without formatting.`,
          });
        else resolve({ text: stdout });
      },
    );
    // 整形器が標準入力を読み終える前に終了すると EPIPE が起きる。その場合の結果は execFile のコールバックで扱う。
    child.stdin?.on('error', () => {});
    child.stdin?.end(text);
  });
}
