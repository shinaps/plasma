import { renderReact, unmountReact } from '../../lib/react-view';
import { ImagePreview } from '../editor/image-preview';

/** 画像の変更前後を並べて表示する。sides が無ければ消す。 */
export function renderImageDiff(
  host: HTMLElement,
  sides?: { before: string; after: string; svg: boolean },
): void {
  if (!sides) {
    unmountReact(host);
    return;
  }
  renderReact(
    host,
    <div className="flex h-full min-h-0 gap-2">
      {(['before', 'after'] as const).map((side) => {
        const content = sides[side];
        const src = sides.svg
          ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`
          : content;
        return (
          <section
            key={side}
            aria-label={side === 'before' ? 'Original image' : 'Modified image'}
            className="min-w-0 flex-1 overflow-auto p-4"
          >
            {content ? (
              <ImagePreview
                key={src}
                src={src}
                label={side === 'before' ? 'Original image' : 'Modified image'}
              />
            ) : (
              <p className="p-8 text-center text-caption text-muted-foreground">No image</p>
            )}
          </section>
        );
      })}
    </div>,
  );
}
