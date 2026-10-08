import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
let pending: Promise<{ path: string | null; supported: boolean }> | undefined;

/** ファイル一覧をアップロードせず、ローカルの絶対パスだけを受け取る。キャンセルは正常終了。 */
export function pickFolder(): Promise<{ path: string | null; supported: boolean }> {
  if (process.platform !== 'darwin') return Promise.resolve({ path: null, supported: false });
  // 複数の画面から押されてもOSのダイアログを重ねない。
  pending ??= execute('/usr/bin/osascript', [
    '-e',
    `
try
  -- OSの許可とユーザーの選択を待つため、AppleEvent既定の短い制限を延長する。
  with timeout of 3600 seconds
    tell application "Finder"
      activate
      set selectedFolder to choose folder with prompt "Open a project in Plasma"
    end tell
  end timeout
  return POSIX path of selectedFolder
on error number -128
  return ""
end try
`,
  ])
    .then(({ stdout }) => ({ path: stdout.trim() || null, supported: true }))
    .finally(() => {
      pending = undefined;
    });
  return pending;
}
