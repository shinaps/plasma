import type { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { errorMessage } from '../../../shared/errors.ts';
import type { Report } from '../../lib/report';

export type Reference = { root: string; path: string };
export type SelectionTarget = Reference & { startLine: number; endLine: number; selected: boolean };
export function referenceText(target: SelectionTarget): string {
  return `${target.root}/${target.path}:${target.startLine}–${target.endLine}`;
}
type Options = {
  extensions: () => OpenAIExtensions | undefined;
  report: Report;
};

/** 選択範囲を会話のコンテキストとして共有する。途中の選択はまとめ、共有は順番に行う。 */
export class SelectionShare {
  private readonly options: Options;
  private timer?: ReturnType<typeof setTimeout>;
  private queue: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private key = '';
  constructor(options: Options) {
    this.options = options;
  }
  update(target: SelectionTarget | undefined, selecting = false): void {
    const key = JSON.stringify(target ?? null);
    if (key === this.key && !selecting) return;
    this.key = key;
    clearTimeout(this.timer);
    const revision = ++this.revision;
    if (selecting) {
      this.key = '';
      return;
    }
    // キーボードでもポインタでも、選択が止まってから共有する。途中の範囲は送らない。
    this.timer = setTimeout(() => {
      this.queue = this.queue
        .catch(() => undefined)
        .then(async () => {
          if (revision !== this.revision) return;
          const text = target ? referenceText(target) : '';
          try {
            const title = target
              ? `…/${target.root.split('/').filter(Boolean).at(-1)}/${target.path}:${target.startLine}–${target.endLine}`
              : '';
            await this.options.extensions()?.modelContext?.update({
              content: [
                {
                  type: 'text',
                  text: text || 'No code selected',
                  ...(target ? { _meta: { 'openai/title': title } } : {}),
                },
              ],
              structuredContent: {
                selection: target
                  ? {
                      root: target.root,
                      path: target.path,
                      startLine: target.startLine,
                      endLine: target.endLine,
                    }
                  : null,
              },
            });
          } catch (error) {
            if (revision === this.revision)
              this.options.report(`Unable to share selection: ${errorMessage(error)}`, true);
          }
        });
    }, 250);
  }
}
