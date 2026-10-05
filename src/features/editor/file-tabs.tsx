import { FileIcon, Icon } from '../../components/icons';
import { renderReact } from '../../lib/react-view';
import type { SplitDirection } from './split-editor';
import { type EditorGroup, startTabDrag } from './tab-drag';

type Tab = {
  id: string;
  label: string;
  title: string;
  active: boolean;
  settings?: boolean;
  draggable?: boolean;
  open: () => void;
  close: () => void;
  split?: (direction: SplitDirection) => void;
  closeOthers?: () => void;
  closeAll?: () => void;
  wrap?: () => void;
  group?: EditorGroup;
};
/** タブ列を描く関数を返す。右クリックで閉じる・分割・折り返しのメニューを出す。 */
export function createFileTabs(host: HTMLElement): (tabs: Tab[]) => void {
  return (tabs: Tab[]) =>
    renderReact(
      host,
      tabs.map((tab, index) => (
        <div
          key={`${tab.settings ? 'settings' : 'file'}:${tab.id}`}
          className={`flex shrink-0 items-center rounded-tab hover:bg-accent hover:text-foreground focus-within:bg-accent focus-within:text-foreground ${tab.active ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
          role="presentation"
        >
          <button
            type="button"
            className="flex h-full touch-none select-none items-center gap-2 whitespace-nowrap rounded-tab border-0 px-3 text-caption hover:bg-transparent"
            role="tab"
            aria-selected={tab.active}
            tabIndex={tab.active ? 0 : -1}
            title={tab.title}
            onContextMenu={(event) => {
              event.preventDefault();
              const menu =
                event.currentTarget.parentElement?.querySelector<HTMLElement>('[popover]');
              if (!menu) return;
              menu.showPopover();
              menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
              menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
              menu.querySelector('button')?.focus();
            }}
            onPointerDown={(event) => {
              if (!tab.settings && tab.draggable !== false)
                startTabDrag(event.nativeEvent, tab.id, tab.group ?? 'left');
            }}
            onClick={tab.open}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              event.preventDefault();
              const next =
                tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
              next.open();
              requestAnimationFrame(() =>
                host.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(),
              );
            }}
          >
            {tab.settings ? <Icon name="settings" /> : <FileIcon path={tab.id} />}
            <span>{tab.label}</span>
          </button>
          <button
            type="button"
            className="mr-1 grid size-6 place-items-center rounded-control p-0 text-body text-muted-foreground hover:bg-surface-raised hover:text-foreground"
            title="Close"
            aria-label={`Close ${tab.title}`}
            onClick={tab.close}
          >
            ×
          </button>
          <div
            popover="auto"
            className="fixed m-0 max-h-[calc(100vh-1rem)] overflow-y-auto [&:popover-open]:flex flex-col items-stretch rounded-control border-0 bg-popover p-1 text-caption text-popover-foreground shadow-popover"
          >
            {[
              { label: 'Close', action: tab.close },
              { label: 'Close Other Tabs', action: tab.closeOthers },
              { label: 'Close All Tabs', action: tab.closeAll },
              { label: 'Split Right', action: tab.split && (() => tab.split?.('right')) },
              { label: 'Split Down', action: tab.split && (() => tab.split?.('down')) },
              { label: 'Toggle Word Wrap', action: tab.wrap },
            ]
              .filter((item) => item.action)
              .map(({ label, action }) => (
                <button
                  key={label}
                  type="button"
                  className="rounded-control px-3 py-2 text-left hover:bg-accent"
                  onClick={(event) => {
                    event.currentTarget.parentElement?.hidePopover();
                    action?.();
                  }}
                >
                  {label}
                </button>
              ))}
          </div>
        </div>
      )),
    );
}
