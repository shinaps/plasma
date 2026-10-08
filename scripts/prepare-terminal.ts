import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// node-pty 1.1.0 の macOS 向けビルドは、補助プログラム spawn-helper に実行権限を付けずに配布されている。
// 最初の PTY を作る前の postinstall で付け直す。
if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  const helper = path.join(
    path.dirname(require.resolve('node-pty/package.json')),
    `prebuilds/darwin-${process.arch}/spawn-helper`,
  );
  try {
    fs.chmodSync(helper, 0o755);
  } catch (error) {
    // 配布物に prebuild が無い構成 (ソースからビルドした node-pty) では付け直す対象が無い。導入を止めない。
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}
