import type * as monaco from 'monaco-editor/editor/editor.api';
import { Fragment, useState } from 'react';
import { errorMessage } from '../../../shared/errors.ts';
import { isSource } from '../../../shared/language.ts';
import type { OutlineSymbol, SendRequest } from '../../../shared/protocol';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '../../components/ui/breadcrumb';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { renderReact, unmountReact } from '../../lib/react-view';

/**
 * 関数一覧とパンくずは同じスナップショットから描き、編集後の古い位置には移動しない。
 * @param host パンくずの直前に挿入する、エディタを含む要素
 * @param path 表示中のファイルのプロジェクト相対パスを返す。空文字なら何も表示しない
 * @param reveal パンくずのパスをプロジェクトツリーで表示する
 */
export function attachCodeNavigation(
  editor: monaco.editor.IStandaloneCodeEditor,
  host: HTMLElement,
  request: SendRequest,
  path: () => string,
  reveal: (path: string) => void,
): void {
  const bar = document.createElement('div');
  bar.className =
    'code-navigation in-data-[view=diff]:hidden in-data-[view=settings]:hidden relative flex shrink-0 items-center gap-2 px-2 py-1 bg-canvas text-caption [&_button]:px-2 [&_button]:py-1';
  host.before(bar);
  let symbols: OutlineSymbol[] = [];
  let revision = 0;
  let timer: ReturnType<typeof setTimeout>;
  const jump = (symbol: OutlineSymbol) => {
    const position = editor.getModel()?.getPositionAt(symbol.start);
    if (!position) return;
    editor.setPosition(position);
    editor.revealPositionInCenter(position);
    editor.focus();
  };
  const render = () => {
    const file = path();
    bar.hidden = !editor.getModel() || !file;
    const model = editor.getModel();
    const position = editor.getPosition();
    const offset = model && position ? model.getOffsetAt(position) : -1;
    const entries = file.split('/').map((part, index, parts) => ({
      key: `path:${parts.slice(0, index + 1).join('/')}`,
      label: part,
      title: parts.slice(0, index + 1).join('/'),
      select: () => reveal(parts.slice(0, index + 1).join('/')),
    }));
    for (const symbol of symbols.filter((symbol) => symbol.start <= offset && offset <= symbol.end))
      entries.push({
        key: `symbol:${symbol.start}:${symbol.name}`,
        label: symbol.name,
        title: symbol.name,
        select: () => jump(symbol),
      });
    renderReact(
      bar,
      bar.hidden ? null : (
        <Navigation key={file} entries={entries} symbols={symbols} jump={jump} error={error} />
      ),
    );
  };
  let error = '';

  const update = () => {
    const generation = ++revision;
    symbols = [];
    error = '';
    render();
    clearTimeout(timer);
    // 解析対象外のファイルはサーバーが常に空を返すので、本文を送らない。
    if (!isSource(path())) return;
    // 入力のたびにサーバーへ解析を頼まないよう、入力が 200ms 止まってから取り直す。
    timer = setTimeout(async () => {
      const model = editor.getModel();
      if (!model) return;
      try {
        const result = await request({ op: 'outline', path: path(), text: model.getValue() });
        if (generation !== revision) return;
        symbols = result.symbols;
        render();
      } catch (cause) {
        if (generation === revision) {
          error = `Structure unavailable: ${errorMessage(cause)}`;
          render();
        }
      }
    }, 200);
  };
  editor.onDidChangeModel(update);
  editor.onDidChangeModelContent(update);
  editor.onDidChangeCursorPosition(render);
  editor.onDidDispose(() => {
    ++revision;
    clearTimeout(timer);
    unmountReact(bar);
    bar.remove();
  });
  update();
}

function Navigation({
  entries,
  symbols,
  jump,
  error,
}: {
  entries: { key: string; label: string; title: string; select: () => void }[];
  symbols: OutlineSymbol[];
  jump: (symbol: OutlineSymbol) => void;
  error: string;
}) {
  const [filter, setFilter] = useState('');
  const filtered = symbols.filter((symbol) =>
    symbol.name.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <>
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList>
          {entries.map((entry, index) => (
            <Fragment key={entry.key}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                <Button variant="plain" size="content" title={entry.title} onClick={entry.select}>
                  {entry.label}
                </Button>
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="plain" size="content">
            Structure
          </Button>
        </PopoverTrigger>
        <PopoverContent aria-label="File structure">
          <Input
            aria-label="Search symbols"
            placeholder="Search symbols"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="mt-1">
            {error ||
              (filtered.length
                ? filtered.map((symbol) => (
                    <Button
                      key={`${symbol.start}:${symbol.name}`}
                      variant="plain"
                      size="content"
                      className="flex w-full justify-start p-1.5 text-caption"
                      style={{ paddingLeft: 8 + symbol.depth * 12 }}
                      title={`${symbol.kind} ${symbol.name}`}
                      onClick={() => jump(symbol)}
                    >
                      {symbol.kind === 'function' ? 'ƒ' : '◇'} {symbol.name}
                    </Button>
                  ))
                : 'No symbols')}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
