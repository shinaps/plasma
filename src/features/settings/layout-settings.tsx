import { useSyncExternalStore } from 'react';
import {
  bottomPanelOptions,
  getBottomPanelSpan,
  setBottomPanelSpan,
  subscribeLayout,
} from '../layout/layout-state';

export function LayoutSettings() {
  const span = useSyncExternalStore(subscribeLayout, getBottomPanelSpan);
  return (
    <section aria-label="Layout">
      <h2 className="mt-8 mb-4 text-body font-semibold">Bottom Panel Width</h2>
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        {bottomPanelOptions.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={span === value}
            onClick={() => setBottomPanelSpan(value)}
            className="rounded-panel bg-muted p-5 text-left ring-1 ring-transparent aria-pressed:ring-ring"
          >
            <span
              aria-hidden="true"
              className="mb-4 grid h-28 grid-cols-[1fr_3fr_1fr] grid-rows-[2fr_1fr] gap-1 rounded-control bg-canvas p-2"
            >
              <span
                className={`rounded-control bg-accent ${value === 'editor' || value === 'right' ? 'row-span-2' : ''}`}
              />
              <span className="col-start-2 row-start-1 rounded-control bg-surface-raised" />
              <span
                className={`col-start-3 row-start-1 rounded-control bg-accent ${value === 'editor' || value === 'left' ? 'row-span-2' : ''}`}
              />
              <span
                className={`rounded-control bg-primary row-start-2 ${value === 'left' || value === 'full' ? 'col-start-1' : 'col-start-2'} ${value === 'right' || value === 'full' ? 'col-end-4' : 'col-end-3'}`}
              />
            </span>
            <span className="text-caption">{label}</span>
          </button>
        ))}
      </div>
      <p className="mt-5 text-caption leading-relaxed text-muted-foreground">
        Applies to bottom panels. Drag panel icons to reposition them and drag boundaries to resize.
      </p>
    </section>
  );
}
