import type * as monaco from 'monaco-editor/editor/editor.api';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '../../components/icons';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { renderReact, unmountReact } from '../../lib/react-view';
import { HtmlPreview } from './html-preview';
import { ImagePreview } from './image-preview';
import { markdownSourceLines, selectedMarkdownLines } from './markdown-selection';

type Mode = 'code' | 'preview' | 'split';

/**
 * Markdown・HTML・SVG のプレビューを付ける。表示を切り替えるだけで、編集と保存は同じ Monaco のモデルを使う。
 * @param editor プレビューの元になるエディタ
 * @param host エディタの要素。プレビューと並べるために包む要素を差し込み、DOM 上の親が変わる
 * @param toolbar 表示切替のボタンを追加する要素
 * @returns エディタとプレビューを包む要素
 */
export function attachDocumentPreview(
  editor: monaco.editor.IStandaloneCodeEditor,
  host: HTMLElement,
  toolbar: HTMLElement,
): HTMLElement {
  const surface = document.createElement('div');
  surface.className = 'flex min-h-0 min-w-0 flex-1 overflow-hidden';
  host.before(surface);
  surface.append(host);
  host.classList.add('min-w-0');
  const preview = document.createElement('article');
  preview.className = 'min-h-0 min-w-0 flex-1 overflow-auto px-6 py-5 text-body text-foreground';
  preview.setAttribute('aria-label', 'Markdown preview');
  const separator = document.createElement('div');
  separator.className =
    'w-2 shrink-0 cursor-col-resize touch-none rounded-control hover:bg-accent focus-visible:bg-accent';
  separator.setAttribute('role', 'separator');
  separator.setAttribute('aria-label', 'Markdown preview width');
  separator.setAttribute('aria-orientation', 'vertical');
  separator.setAttribute('aria-valuemin', '20');
  separator.setAttribute('aria-valuemax', '80');
  separator.tabIndex = 0;
  surface.append(separator, preview);
  let sourcePercent = 50;
  const resize = (percent: number) => {
    sourcePercent = Math.max(20, Math.min(80, percent));
    host.style.flex = `0 0 calc(${sourcePercent}% - 0.25rem)`;
    separator.setAttribute('aria-valuenow', String(Math.round(sourcePercent)));
    editor.layout();
  };
  separator.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    separator.setPointerCapture(event.pointerId);
  };
  separator.onpointermove = (event) => {
    if (!separator.hasPointerCapture(event.pointerId)) return;
    const bounds = surface.getBoundingClientRect();
    resize(((event.clientX - bounds.left) / bounds.width) * 100);
  };
  separator.onpointerup = (event) => {
    if (separator.hasPointerCapture(event.pointerId))
      separator.releasePointerCapture(event.pointerId);
  };
  separator.onkeydown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    resize(sourcePercent + (event.key === 'ArrowLeft' ? -5 : 5));
  };
  const controls = document.createElement('div');
  controls.className = 'ml-auto flex shrink-0 items-center gap-1';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Markdown view');
  toolbar.append(controls);
  let mode: Mode = 'code';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const isSvg = () => /\.svg$/i.test(editor.getModel()?.uri.path ?? '');
  const isHtml = () => /\.html?$/i.test(editor.getModel()?.uri.path ?? '');
  const render = () => {
    if (isHtml()) {
      renderReact(preview, <HtmlPreview source={editor.getModel()?.getValue() ?? ''} />);
      return;
    }
    if (isSvg()) {
      const source = editor.getModel()?.getValue() ?? '';
      renderReact(
        preview,
        <ImagePreview
          key={source}
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`}
          label="SVG preview"
        />,
      );
      return;
    }
    renderReact(
      preview,
      <div className="w-full break-words leading-relaxed [&_h1]:mb-6 [&_h1]:text-brand [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:mb-4 [&_h2]:text-title [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-3 [&_h3]:font-semibold [&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_pre]:overflow-auto [&_pre]:rounded-control [&_pre]:bg-surface [&_pre]:p-4 [&_code]:font-mono [&_code]:text-caption [&_blockquote]:rounded-control [&_blockquote]:bg-surface [&_blockquote]:px-4 [&_blockquote]:py-1 [&_blockquote]:text-muted-foreground [&_a]:text-primary [&_a]:underline [&_table]:w-full [&_th]:p-2 [&_th]:text-left justify-start [&_th]:bg-surface [&_td]:border-b [&_td]:border-border [&_td]:p-2 [&_hr]:my-6 [&_hr]:border-border">
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[markdownSourceLines]}
          skipHtml
          components={{
            a: ({ href, children }) =>
              href && /^https?:\/\//i.test(href) ? (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ) : (
                <span>{children}</span>
              ),
            // プレビューを開いただけで外部の画像を取りに行かない。
            img: ({ alt }) => <span className="text-muted-foreground">{alt || 'Image'}</span>,
          }}
        >
          {editor.getModel()?.getValue() ?? ''}
        </Markdown>
      </div>,
    );
  };
  const update = () => {
    const supported = isHtml() || isSvg() || editor.getModel()?.getLanguageId() === 'markdown';
    const label = isHtml() ? 'HTML' : isSvg() ? 'SVG' : 'Markdown';
    preview.classList.toggle('px-6', !isHtml());
    preview.classList.toggle('py-5', !isHtml());
    preview.setAttribute('aria-label', `${label} preview`);
    controls.setAttribute('aria-label', `${label} view`);
    separator.setAttribute('aria-label', `${label} preview width`);
    const effective = supported ? mode : 'code';
    controls.hidden = !supported;
    host.hidden = effective === 'preview';
    preview.hidden = effective === 'code';
    separator.hidden = effective !== 'split';
    if (effective === 'split') resize(sourcePercent);
    else host.style.flex = '1 1 0%';
    renderReact(
      controls,
      <ToggleGroup
        type="single"
        aria-label={`${label} view`}
        value={effective}
        onValueChange={(value) => {
          if (value) {
            mode = value as Mode;
            update();
          }
        }}
      >
        {(
          [
            ['code', 'Code'],
            ['preview', 'Preview'],
            ['split', 'Split View'],
          ] as const
        ).map(([value, title]) => (
          <ToggleGroupItem key={value} value={value} title={title} aria-label={title}>
            <Icon name={value} />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>,
    );
    if (!preview.hidden) render();
    else unmountReact(preview);
    editor.layout();
  };
  const shareSelection = () => {
    const lines = selectedMarkdownLines(preview);
    const model = editor.getModel();
    if (isHtml() || isSvg() || !lines || !model || preview.hidden) return;
    // Monaco の選択を更新すると、ファイルと行の共有は既存の経路で行われる。フォーカスはプレビューに残す。
    editor.setSelection({
      startLineNumber: lines.startLine,
      startColumn: 1,
      endLineNumber: lines.endLine,
      endColumn: model.getLineMaxColumn(lines.endLine),
    });
  };
  preview.addEventListener('pointerup', shareSelection);
  preview.addEventListener('keyup', shareSelection);
  const subscriptions = [
    editor.onDidChangeModel(update),
    editor.onDidChangeModelLanguage(update),
    editor.onDidChangeModelContent(() => {
      clearTimeout(timer);
      if (!preview.hidden) timer = setTimeout(render, 120);
    }),
  ];
  editor.onDidDispose(() => {
    clearTimeout(timer);
    for (const subscription of subscriptions) subscription.dispose();
    unmountReact(preview);
    unmountReact(controls);
  });
  update();
  return surface;
}
