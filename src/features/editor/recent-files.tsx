import { ArrowUpRight } from 'lucide-react';
import plasmaMark from '../../../assets/plasma.svg?inline';
import { FileIcon } from '../../components/icons';
import { renderReact } from '../../lib/react-view';

export function showRecentFiles(
  host: HTMLElement,
  paths: string[],
  open: (path: string) => void,
): void {
  renderReact(
    host,
    <section
      className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center px-8 py-12"
      aria-label="Recent Files"
    >
      <header className="mb-10 flex items-center gap-4">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-card bg-surface-raised shadow-panel ring-1 ring-border"
          aria-hidden="true"
        >
          <img src={plasmaMark} alt="" className="size-7" />
        </span>
        <h1 className="m-0 text-brand font-medium tracking-tight text-foreground">Plasma</h1>
      </header>
      <h2 className="mb-4 px-1 text-caption font-medium text-muted-foreground">Recent Files</h2>
      {paths.length ? (
        <ul className="m-0 list-none space-y-1 rounded-card bg-surface-raised p-2">
          {paths.map((path) => (
            <li key={path}>
              <button
                type="button"
                title={path}
                onClick={() => open(path)}
                className="group flex w-full items-center gap-3.5 rounded-panel border-0 bg-transparent px-3 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-control bg-surface-raised"
                  aria-hidden="true"
                >
                  <FileIcon path={path} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-foreground">
                    {path.split('/').at(-1)}
                  </span>
                  {path.includes('/') && (
                    <span className="block truncate text-caption text-muted-foreground">
                      {path.slice(0, path.lastIndexOf('/'))}
                    </span>
                  )}
                </span>
                <ArrowUpRight
                  size={16}
                  aria-hidden="true"
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">Open a file from the project tree</p>
      )}
    </section>,
  );
}
