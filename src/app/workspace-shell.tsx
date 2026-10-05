import { History } from 'lucide-react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Icon } from '../components/icons';
import { Tooltip, TooltipProvider } from '../components/ui/tooltip';
import { requireElement } from '../lib/dom';
import { ReactViews } from '../lib/react-view';

// 固定の雛形。マウント後は再描画しない。属性とエディタ等の描画先はコントローラが持ち、ポータルの中身は React が持つ。
// パネルの配置と 3 本のレールにあるボタンは ToolDock が担当する。
function WorkspaceShell() {
  return (
    <TooltipProvider delayDuration={400}>
      <div
        id="global-notice"
        className="fixed top-6 left-1/2 z-[100] max-w-[600px] -translate-x-1/2 rounded-panel bg-destructive-surface p-5 whitespace-pre-wrap text-destructive [&_button]:mt-4 [&_button]:block [&_button]:bg-accent [&_button]:px-4 [&_button]:py-2"
        hidden
      />
      <div className="workspace grid h-full [--dock-height:18rem] [--dock-left-width:26rem] [--dock-right-width:26rem] [--right-rail-width:2.5rem] [--bottom-rail-height:2.25rem] bg-canvas pt-2 [body:not(.docking)_&:has(>.right-rail:empty)]:[--right-rail-width:0px] [body:not(.docking)_&:has(>.right-rail:empty)]:pr-2 [body:not(.docking)_&:has(>.bottom-rail:empty)]:[--bottom-rail-height:0px] [body:not(.docking)_&:has(>.bottom-rail:empty)]:pb-2">
        <nav
          className="tool-rail col-start-1 row-start-1 row-end-4 w-10 flex shrink-0 flex-col items-center gap-1.5 border-0 bg-transparent pt-0 [&_button]:grid [&_button]:size-8 [&_button]:place-items-center [&_button]:rounded-control [&_button]:text-muted-foreground [&_button.active]:bg-accent [&_button.active]:text-foreground [body.docking_&]:ring-1 [body.docking_&]:ring-border [&.dock-target]:bg-accent [&.dock-target]:ring-2 [&.dock-target]:ring-ring"
          data-dock-side="left"
          aria-label="Tool windows"
        >
          <button type="button" id="home" aria-label="Back to projects" title="Back to projects">
            <Icon name="home" />
          </button>
          <button
            type="button"
            id="project-tool"
            className="active"
            aria-label="Project"
            title="Project · ⌘1"
          >
            <Icon name="project" />
          </button>
          <button type="button" id="git-tool" aria-label="Git Changes" title="Git Changes">
            <Icon name="git" />
          </button>
          <button
            type="button"
            className="order-2 mt-auto mb-2"
            id="settings-tool"
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" />
          </button>
        </nav>
        <aside
          id="sidebar"
          className="col-start-2 row-start-1 flex w-72 max-md:w-52 max-sm:w-40 min-w-36 max-w-[50vw] shrink-0 flex-col overflow-hidden rounded-panel bg-surface shadow-panel"
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-3">
            <strong id="panel-title" className="text-caption font-semibold">
              Project
            </strong>
            <div className="flex gap-0">
              <Tooltip
                title="Reveal Active File"
                description="Reveal the active file in the project tree."
              >
                <button
                  type="button"
                  id="reveal"
                  className="inline-grid size-7 shrink-0 place-items-center rounded-control text-body hover:bg-accent"
                  aria-label="Reveal Active File"
                >
                  <Icon name="locate" />
                </button>
              </Tooltip>
              <Tooltip
                title="Expand Selected"
                description="Expand the selected folder and all its descendants."
              >
                <button
                  type="button"
                  id="expand"
                  className="inline-grid size-7 shrink-0 place-items-center rounded-control text-body hover:bg-accent"
                  aria-label="Expand Selected"
                >
                  <Icon name="expand" />
                </button>
              </Tooltip>
              <Tooltip title="Collapse All" description="Collapse all folders.">
                <button
                  type="button"
                  id="collapse"
                  className="inline-grid size-7 shrink-0 place-items-center rounded-control text-body hover:bg-accent"
                  aria-label="Collapse All"
                >
                  <Icon name="collapse" />
                </button>
              </Tooltip>
              <Tooltip title="Refresh" description="Refresh files and Git changes.">
                <button
                  type="button"
                  id="refresh"
                  className="inline-grid size-7 shrink-0 place-items-center rounded-control text-body hover:bg-accent"
                  aria-label="Refresh"
                >
                  <Icon name="refresh" />
                </button>
              </Tooltip>
            </div>
          </div>
          <div id="project-panel" className="flex min-h-0 flex-1 flex-col">
            <div className="px-2.5 pt-2 pb-2">
              <input
                className="w-full rounded-control border border-input bg-background px-2 py-1.5 text-caption text-foreground placeholder:text-muted-foreground"
                id="filter"
                aria-label="Search files"
                placeholder="Search files"
              />
            </div>
            <nav id="files" className="flex-1 overflow-auto px-1.5 pb-3"></nav>
          </div>
          <section className="flex min-h-0 flex-1 flex-col" id="git-panel" hidden></section>
          <div className="flex justify-between gap-2.5 px-3 py-1.5 text-caption text-muted-foreground [&:not(:has(span:not(:empty)))]:hidden">
            <span id="branch" className="truncate"></span>
          </div>
        </aside>
        {/* biome-ignore lint/a11y/useSemanticElements: This focusable separator resizes the sidebar; it is not a thematic break. */}
        <div
          className="col-start-3 row-start-1 relative z-10 w-2 shrink-0 cursor-col-resize touch-none bg-transparent after:absolute after:inset-y-2 after:left-0.5 after:w-0.5 after:rounded-control hover:after:bg-ring [&.dragging]:after:bg-ring"
          id="resize"
          role="separator"
          aria-label="Project sidebar width"
          aria-orientation="vertical"
          aria-valuemin={150}
          aria-valuemax={440}
          aria-valuenow={292}
          tabIndex={0}
        ></div>
        <div className="work-area col-start-6 row-start-1 flex min-h-0 min-w-0">
          <div className="editor-stack flex min-h-0 min-w-0 flex-1">
            <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [&.settings-active>#notice]:hidden rounded-panel bg-background shadow-panel">
              <div className="flex h-12 shrink-0 items-center bg-background p-2">
                <div
                  className="flex h-full min-w-0 flex-1 gap-1.5 overflow-x-auto"
                  id="tabs"
                  role="tablist"
                  aria-label="Open files"
                ></div>
                <div className="toolbar flex shrink-0 items-center gap-1">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      id="problems-toggle"
                      className="inline-grid h-7 shrink-0 place-items-center rounded-control px-2 text-caption tabular-nums hover:bg-accent"
                      title="Problems · ⇧⌘M"
                      aria-label="Toggle Problems Panel"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      id="reload"
                      className="group relative inline-grid size-7 shrink-0 place-items-center rounded-control text-body hover:bg-accent"
                      title="Reload from Disk"
                      aria-label="Reload from Disk"
                    >
                      ↻
                    </button>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 px-2 [&_button]:rounded-control [&_button]:px-2 [&_button]:py-1 [&_button]:text-caption">
                  <button type="button" id="save" title="Save All · ⌘S" hidden>
                    Save
                  </button>
                </div>
              </div>
              <div
                className="max-h-24 overflow-auto bg-accent px-3 py-2 text-caption whitespace-pre-wrap text-foreground [&.error]:bg-destructive-surface [&.error]:text-destructive"
                id="notice"
                role="status"
                hidden
              ></div>
              <div id="editor" className="min-h-24 flex-1 overflow-hidden"></div>
              <section
                id="image-view"
                className="min-h-0 flex-1 overflow-auto p-6"
                aria-label="Image preview"
                hidden
              ></section>
              <div id="recent-files" className="min-h-0 flex-1 overflow-auto" hidden></div>
              <section className="flex min-h-0 flex-1 flex-col" id="diff-view" hidden></section>
              <section
                id="settings-view"
                className="block flex-1 min-h-0 overflow-auto p-8 max-[850px]:p-5"
                role="tabpanel"
                aria-label="Settings"
                hidden
              ></section>
              <section id="results" className="flex h-52 max-h-[38vh] flex-col bg-surface" hidden>
                <div className="flex h-9 shrink-0 items-center gap-4 px-3 [&_button]:text-caption [&_button]:text-muted-foreground [&_.active]:text-foreground [&_span]:ml-1 [&_span]:tabular-nums">
                  <button type="button" id="problems-tab" className="active">
                    Problems <span id="problem-count">0</span>
                  </button>
                  <button type="button" id="refs-tab">
                    References <span id="refs-count">0</span>
                  </button>
                  <button
                    type="button"
                    id="close-results"
                    className="ml-auto grid size-7 shrink-0 place-items-center rounded-control text-body hover:bg-accent"
                    aria-label="Close Results Panel"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                <div
                  id="problems"
                  className="flex-1 overflow-auto px-2.5 py-2 text-caption leading-relaxed text-muted-foreground"
                ></div>
                <div
                  id="refs"
                  className="flex-1 overflow-auto px-2.5 py-2 text-caption leading-relaxed text-muted-foreground"
                  hidden
                ></div>
              </section>
            </main>
            <div id="git-history-view" className="min-h-0 shrink-0" hidden />
          </div>
        </div>
        <nav
          className="tool-rail right-rail col-start-9 row-start-1 row-end-4 w-10 [body:not(.docking)_&:empty]:hidden flex shrink-0 flex-col items-center gap-1.5 border-0 bg-transparent pt-0 [&_button]:grid [&_button]:size-8 [&_button]:place-items-center [&_button]:rounded-control [&_button]:text-muted-foreground [&_button.active]:bg-accent [&_button.active]:text-foreground [body.docking_&]:ring-1 [body.docking_&]:ring-border [&.dock-target]:bg-accent [&.dock-target]:ring-2 [&.dock-target]:ring-ring"
          data-dock-side="right"
          aria-label="Right tool windows"
        ></nav>
        <nav
          className="tool-rail bottom-rail col-span-full row-start-4 flex-row! px-1 pt-0! [body:not(.docking)_&:empty]:hidden flex shrink-0 flex-col items-center gap-1.5 border-0 bg-transparent pt-0 [&_button]:grid [&_button]:size-8 [&_button]:place-items-center [&_button]:rounded-control [&_button]:text-muted-foreground [&_button.active]:bg-accent [&_button.active]:text-foreground [body.docking_&]:ring-1 [body.docking_&]:ring-border [&.dock-target]:bg-accent [&.dock-target]:ring-2 [&.dock-target]:ring-ring"
          data-dock-side="bottom"
          aria-label="Bottom tool windows"
        >
          <button
            type="button"
            id="git-history-tool"
            aria-label="Git History"
            aria-expanded="false"
            title="Git History"
          >
            <History size={16} />
          </button>
        </nav>
      </div>
    </TooltipProvider>
  );
}
export function mountWorkspace(): void {
  const root = createRoot(requireElement('#app'));
  // コントローラはマウント直後に描画先の要素を探すので、同期的に描画を確定させる。
  flushSync(() =>
    root.render(
      <>
        <WorkspaceShell />
        <ReactViews />
      </>,
    ),
  );
}
