import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pty from 'node-pty';
import { errorCode } from '../shared/errors.ts';
import { limits } from '../shared/limits.ts';
import type {
  EmptyResult,
  ResponseOf,
  TerminalOutput,
  TerminalSession,
} from '../shared/protocol.ts';

export type Shell = Pick<pty.IPty, 'pid' | 'write' | 'resize' | 'kill' | 'onData' | 'onExit'>;
export type SpawnShell = (root: string) => Shell;
type Session = TerminalSession & {
  shell: Shell;
  /** 保持している出力。古い分は削除済み */
  output: string;
  /** 削除した出力の文字数。read の cursor は出力全体での位置なので、output 内の位置はこの値を引いて求める */
  offset: number;
};
/** 起動直後の大きさ。xterm の描画が確定すると resize で実際の値が届く。 */
const defaultSize = { cols: 100, rows: 24 };

const spawnLoginShell: SpawnShell = (root) =>
  pty.spawn(process.env.SHELL || '/bin/zsh', ['-l'], {
    cwd: root,
    name: 'xterm-256color',
    cols: defaultSize.cols,
    rows: defaultSize.rows,
    env: { ...process.env, TERM: 'xterm-256color' },
  });

/** プロジェクトごとのシェルのタブ。タブを閉じるまでプロセスと出力を保持する。 */
export class ShellTerminal {
  private readonly root: string;
  private readonly spawn: SpawnShell;
  private readonly sessions = new Map<string, Session>();
  private sequence = 0;
  constructor(root: string, spawn: SpawnShell = spawnLoginShell) {
    this.root = root;
    this.spawn = spawn;
  }
  list(): ResponseOf<'terminal-list'> {
    return {
      sessions: [...this.sessions.values()].map(({ id, title, exitCode }) => ({
        id,
        title,
        exitCode,
      })),
    };
  }
  start(): TerminalSession {
    const shell = this.spawn(this.root);
    const session: Session = {
      id: randomUUID(),
      title: `Terminal ${++this.sequence}`,
      shell,
      output: '',
      offset: 0,
      exitCode: null,
    };
    this.sessions.set(session.id, session);
    shell.onData((data) => {
      session.output += data;
      // 上限を 1 回分の読み取り量だけ超えてからまとめて削る。chunk ごとに 1 MB をコピーし直さない。
      if (session.output.length > limits.terminalScrollback + limits.terminalReadChunk) {
        const trim = session.output.length - limits.terminalScrollback;
        session.output = session.output.slice(trim);
        session.offset += trim;
      }
    });
    shell.onExit(({ exitCode }) => {
      session.exitCode = exitCode;
    });
    return { id: session.id, title: session.title, exitCode: null };
  }
  /**
   * @param cursor 前回の read が返した位置。保持している範囲より前なら truncated を立てて先頭から返す
   */
  read(id: string, cursor: number): TerminalOutput {
    const session = this.session(id);
    // 出力の末尾より先の位置は末尾に丸める。後で出力が伸びたときに手前が飛ばないようにする。
    const from = Math.min(Math.max(session.offset, cursor), session.offset + session.output.length);
    const data = session.output.slice(
      from - session.offset,
      from - session.offset + limits.terminalReadChunk,
    );
    return {
      data,
      cursor: from + data.length,
      truncated: cursor < session.offset,
      exitCode: session.exitCode,
    };
  }
  write(id: string, text: string): EmptyResult {
    const session = this.session(id);
    if (session.exitCode !== null) throw new Error('The shell has exited.');
    session.shell.write(text);
    return {};
  }
  resize(id: string, cols: number, rows: number): EmptyResult {
    const session = this.session(id);
    // 描画前の 0 や極端な値を PTY に渡さない。xterm のレイアウトが確定すると実際の値が来る。
    if (session.exitCode === null)
      session.shell.resize(
        Math.max(2, Math.min(500, cols || defaultSize.cols)),
        Math.max(2, Math.min(300, rows || defaultSize.rows)),
      );
    return {};
  }
  close(id: string): ResponseOf<'terminal-close'> {
    const session = this.sessions.get(id);
    if (!session) return {};
    let incomplete = false;
    if (session.exitCode === null) {
      // ジョブは別のプロセスグループを持つ。子孫から順に終了するが、権限のない子がいても PTY は閉じる。
      try {
        const processes = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
          .trim()
          .split('\n')
          .map((line) => line.trim().split(/\s+/).map(Number));
        const terminateChildren = (parent: number): void => {
          for (const [pid, ppid] of processes) {
            if (ppid !== parent) continue;
            terminateChildren(pid);
            try {
              process.kill(pid, 'SIGKILL');
            } catch (error) {
              if (errorCode(error) !== 'ESRCH') incomplete = true;
            }
          }
        };
        terminateChildren(session.shell.pid);
      } catch {
        incomplete = true;
      }
      try {
        session.shell.kill('SIGKILL');
      } catch (error) {
        if (errorCode(error) !== 'ESRCH') incomplete = true;
      }
    }
    this.sessions.delete(session.id);
    return incomplete
      ? { warning: 'Tab closed, but some processes could not be terminated. Check permissions.' }
      : {};
  }
  dispose(): void {
    for (const id of [...this.sessions.keys()]) {
      const { warning } = this.close(id);
      if (warning) console.error(warning);
    }
  }
  private session(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Terminal session has ended. Open a new tab.');
    return session;
  }
}
