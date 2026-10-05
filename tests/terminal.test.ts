import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Shell, ShellTerminal } from '../server/terminal.ts';

// 利用者のログインシェルの設定 (.zprofile など) に左右されないように、テストは /bin/sh で動かす。
process.env.SHELL = '/bin/sh';

// 出力の到着を待つ回数と間隔。合計 5 秒でシェルの起動と echo が終わる。
const polling = { attempts: 100, intervalMs: 50 };
// プロセスの終了を待つ回数と間隔。
const exitPolling = { attempts: 100, intervalMs: 20 };
const resized = { cols: 90, rows: 20 };
const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
async function outputUntil(
  terminal: ShellTerminal,
  id: string,
  predicate: (result: ReturnType<ShellTerminal['read']>) => boolean,
): Promise<ReturnType<ShellTerminal['read']>> {
  let result = terminal.read(id, 0);
  for (let i = 0; i < polling.attempts; i++) {
    result = terminal.read(id, 0);
    if (predicate(result)) return result;
    await delay(polling.intervalMs);
  }
  assert.fail(`Terminal condition not met: ${JSON.stringify(result)}`);
}

// 入力した文字列はそのまま画面に表示 (エコー) される。出力の中で入力行と区別するため、
// 目印の先頭文字 T を \x54 と書いて送り、出力側では改行の後に続く TAB_ を探す。
test('tabs have independent PTYs and closing one leaves other tabs usable', async () => {
  const terminal = new ShellTerminal(process.cwd());
  try {
    const first = terminal.start();
    const second = terminal.start();
    assert.notEqual(first.id, second.id);
    assert.equal(terminal.list().sessions.length, 2);
    assert.throws(() => terminal.write('stale', 'bad'));
    terminal.resize(first.id, resized.cols, resized.rows);
    terminal.write(first.id, "printf '\\x54AB_A_ONLY\\n'\r");
    const output = await outputUntil(terminal, first.id, (result) =>
      result.data.includes('\r\nTAB_A_ONLY'),
    );
    assert.ok(terminal.read(first.id, 0).data.startsWith(output.data));
    assert.ok(!terminal.read(second.id, 0).data.includes('TAB_A_ONLY'));
    terminal.close(first.id);
    terminal.close(first.id);
    assert.throws(() => terminal.read(first.id, 0));
    terminal.write(second.id, "printf '\\x54AB_B_ALIVE\\n'\r");
    await outputUntil(terminal, second.id, (result) => result.data.includes('\r\nTAB_B_ALIVE'));
    terminal.write(second.id, 'exit\r');
    await outputUntil(terminal, second.id, (result) => result.exitCode === 0);
    terminal.close(second.id);
    assert.deepEqual(terminal.list().sessions, []);
    const fresh = terminal.start();
    assert.notEqual(fresh.id, first.id);
    assert.ok(!terminal.read(fresh.id, 0).data.includes('TAB_A_ONLY'));
  } finally {
    terminal.dispose();
  }
});

test('closing a tab terminates its foreground child process and login shell', async () => {
  const terminal = new ShellTerminal(process.cwd());
  try {
    const { id } = terminal.start();
    // $$ は子シェル自身の PID、$PPID はそれを起動したログインシェルの PID。
    terminal.write(id, "sh -c 'echo CHILD_PID=$$ SHELL_PID=$PPID; exec sleep 60'\r");
    const output = await outputUntil(terminal, id, (result) =>
      /\r\nCHILD_PID=\d+ SHELL_PID=\d+/.test(result.data),
    );
    const match = output.data.match(/\r\nCHILD_PID=(\d+) SHELL_PID=(\d+)/);
    assert.ok(match);
    const childPid = Number(match[1]);
    const shellPid = Number(match[2]);
    terminal.close(id);
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < exitPolling.attempts && (alive(shellPid) || alive(childPid)); i++)
      await delay(exitPolling.intervalMs);
    assert.equal(alive(childPid), false);
    assert.equal(alive(shellPid), false);
  } finally {
    terminal.dispose();
  }
});

test('cleanup releases every session even if one process cannot be terminated', () => {
  const noListeners = { dispose(): void {} };
  const fakeShell = (kill: () => void): Shell => ({
    pid: -1,
    write(): void {},
    resize(): void {},
    kill,
    onData: () => noListeners,
    onExit: () => noListeners,
  });
  const denied = new ShellTerminal(process.cwd(), () =>
    fakeShell(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    }),
  );
  const { id } = denied.start();
  assert.match(denied.close(id).warning ?? '', /could not be terminated/);
  assert.deepEqual(denied.list().sessions, []);
  let killed = false;
  const releasing = new ShellTerminal(process.cwd(), () =>
    fakeShell(() => {
      killed = true;
    }),
  );
  releasing.start();
  releasing.dispose();
  assert.equal(killed, true);
  assert.deepEqual(releasing.list().sessions, []);
});
