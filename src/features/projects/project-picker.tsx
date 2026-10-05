import { Folder } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import plasmaMark from '../../../assets/plasma.svg?inline';
import { errorMessage } from '../../../shared/errors.ts';
import type { RecentProject, ResponseOf, SendRequest } from '../../../shared/protocol.ts';
import { renderReact, unmountReact } from '../../lib/react-view';
import { openProject } from './open-project';

type FolderList = ResponseOf<'project-browse'>;
function ProjectPicker({
  request,
  onOpen,
}: {
  request: SendRequest;
  onOpen: (root: string) => void;
}) {
  const [projectList, setProjectList] = useState<ResponseOf<'project-list'>>({
    recent: [],
    home: '~',
  });
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState<FolderList>();
  const contextMenu = useRef<HTMLDivElement>(null);
  // 右クリックしたプロジェクト。描画には使わないのでメニューの処理だけが参照する。
  const contextProject = useRef<RecentProject>(undefined);
  const busyRef = useRef(false);
  const browseButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    request({ op: 'project-list' })
      .then((value) => {
        if (live) setProjectList(value);
      })
      .catch((cause: unknown) => {
        if (live) setError(errorMessage(cause));
      });
    return () => {
      live = false;
    };
  }, [request]);
  useEffect(() => {
    browseButton.current?.focus();
  }, []);
  /** 二重実行を防ぎ、失敗を表示する。要求を送る操作はすべてここを通す。 */
  async function run(task: () => Promise<void>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const browseFolder = (path: string): Promise<void> =>
    run(async () => {
      const result = await request({ op: 'project-browse', path });
      setFolders(result);
      setInput(result.root);
    });
  const openFolder = (path: string): Promise<void> =>
    run(async () => {
      const result = await openProject(request, path);
      if (result) onOpen(result.root);
    });
  const forgetProject = (): Promise<void> =>
    run(async () => {
      const project = contextProject.current;
      if (!project) return;
      const result = await request({ op: 'project-forget', path: project.root });
      setProjectList((previous) => ({ ...previous, recent: result.recent }));
    });
  return (
    <div className="my-auto w-full max-w-xl">
      <header className="mb-10 flex items-center gap-3.5">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-card bg-surface-raised text-foreground ring-1 ring-border [&_img]:size-7"
          aria-hidden="true"
        >
          <img src={plasmaMark} alt="" />
        </span>
        <h1 className="m-0 text-brand font-medium tracking-tight text-foreground">Plasma</h1>
      </header>
      <section className="[&_button]:rounded-control" aria-label="Open Project">
        <button
          ref={browseButton}
          type="button"
          className="flex w-full items-center gap-3 bg-inverse px-4 py-4 text-left text-body font-medium text-inverse-foreground hover:bg-inverse/90 [&_svg]:size-5"
          disabled={busy}
          onClick={() => void browseFolder(input || folders?.root || projectList.home)}
        >
          <Folder />
          <span>Open Folder</span>
          <span className="ml-auto text-title opacity-60" aria-hidden="true">
            ↗
          </span>
        </button>
        <form
          className="mt-3 flex items-center gap-2 rounded-control bg-background p-1 ring-1 ring-border [&_button]:shrink-0 [&_button]:px-3 [&_button]:py-2"
          onSubmit={(event) => {
            event.preventDefault();
            void openFolder(input);
          }}
        >
          <input
            className="min-w-0 flex-1 rounded-control border-0 bg-transparent p-2.5 text-caption text-foreground placeholder:text-muted-foreground"
            aria-label="Folder path"
            placeholder="Or enter a folder path"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button disabled={busy} type="submit" title="Open Folder Path">
            Open <span aria-hidden="true">↵</span>
          </button>
        </form>
      </section>
      {error && (
        <p className="break-words text-caption leading-relaxed text-destructive" role="alert">
          {error}
        </p>
      )}
      {folders && (
        <div className="mt-4 overflow-hidden rounded-panel bg-background ring-1 ring-border">
          <div className="flex flex-wrap items-center gap-2 p-2">
            <button
              type="button"
              className="shrink-0 rounded-control p-2 hover:bg-accent"
              aria-label="Parent Folder"
              title="Parent Folder"
              disabled={busy}
              onClick={() => void browseFolder(folders.parent)}
            >
              ↑
            </button>
            <span
              className="min-w-0 flex-1 truncate text-caption text-muted-foreground"
              title={folders.root}
            >
              {folders.root}
            </span>
            <button
              type="button"
              className="shrink-0 rounded-control p-2 text-caption hover:bg-accent"
              disabled={busy}
              onClick={() => void openFolder(folders.root)}
            >
              Open This Folder
            </button>
          </div>
          <div className="grid max-h-60 overflow-auto p-1.5 [&_button]:rounded-control [&_button]:px-3 [&_button]:py-2 [&_button]:text-left [&_button:hover]:bg-accent">
            {folders.folders.map((folder) => (
              <button
                type="button"
                key={folder.path}
                disabled={busy}
                onClick={() => void browseFolder(folder.path)}
              >
                {folder.name}
              </button>
            ))}
            {!folders.folders.length && 'No subfolders'}
          </div>
        </div>
      )}
      <div
        ref={contextMenu}
        popover="auto"
        className="fixed m-0 rounded-control border-0 bg-popover p-1 text-caption text-popover-foreground shadow-popover"
      >
        <button
          type="button"
          className="rounded-control px-3 py-2 hover:bg-accent"
          onClick={() => {
            contextMenu.current?.hidePopover();
            void forgetProject();
          }}
        >
          Remove from Recent Projects
        </button>
      </div>
      {!!projectList.recent.length && (
        <section className="mt-9">
          <h2 className="mb-3 text-caption font-medium text-muted-foreground">Recent Projects</h2>
          <div className="grid gap-1 [&_button]:flex [&_button]:w-full [&_button]:items-center [&_button]:gap-3.5 [&_button]:rounded-control [&_button]:p-3 [&_button]:text-left [&_button:hover]:bg-accent">
            {projectList.recent.map((project) => (
              <button
                type="button"
                key={project.root}
                onContextMenu={(event) => {
                  event.preventDefault();
                  contextProject.current = project;
                  const menu = contextMenu.current;
                  if (!menu) return;
                  menu.showPopover();
                  menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
                  menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
                  menu.querySelector('button')?.focus();
                }}
                title={project.root}
                disabled={busy}
                onClick={() => void openFolder(project.root)}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-control bg-surface-raised text-foreground [&_svg]:size-4.5">
                  <Folder />
                </span>
                <span className="grid min-w-0 gap-1 [&_strong]:truncate [&_strong]:text-body [&_strong]:font-medium [&_span]:truncate [&_span]:text-caption [&_span]:text-muted-foreground">
                  <strong>{project.name}</strong>
                  <span>
                    {project.root.startsWith(`${projectList.home}/`)
                      ? `~${project.root.slice(projectList.home.length)}`
                      : project.root}
                  </span>
                </span>
                <span className="ml-auto text-title opacity-60" aria-hidden="true">
                  ↗
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
/**
 * プロジェクト選択画面を表示し、選ばれたプロジェクトのルートを返す。
 * @param subscribe 会話からのリンクで選択を確定させる経路。選択関数を受け取り、解除関数を返す
 */
export function chooseProject(
  request: SendRequest,
  subscribe?: (select: (root: string) => void) => () => void,
): Promise<string> {
  const host = document.createElement('section');
  host.className =
    'fixed inset-0 flex justify-center overflow-auto bg-surface px-7 py-12 text-body text-foreground';
  host.setAttribute('aria-label', 'Open Project');
  document.body.append(host);

  return new Promise((resolve) => {
    let unsubscribe: (() => void) | undefined;
    const select = (root: string): void => {
      unsubscribe?.();
      unmountReact(host);
      host.remove();
      resolve(root);
    };
    unsubscribe = subscribe?.(select);
    renderReact(host, <ProjectPicker request={request} onOpen={select} />);
  });
}
