import { FileIcon, Icon } from '../../components/icons';
import { Button } from '../../components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
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
        <ContextMenu key={`${tab.settings ? 'settings' : 'file'}:${tab.id}`}>
          <ContextMenuTrigger asChild>
            <div
              className={`flex shrink-0 items-center rounded-tab hover:bg-accent hover:text-foreground focus-within:bg-accent focus-within:text-foreground ${tab.active ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
              role="presentation"
            >
              <Button
                variant="plain"
                size="content"
                type="button"
                className="flex h-full touch-none select-none items-center gap-2 whitespace-nowrap rounded-tab border-0 px-3 text-caption hover:bg-transparent"
                role="tab"
                aria-selected={tab.active}
                tabIndex={tab.active ? 0 : -1}
                title={tab.title}
                onPointerDown={(event) => {
                  if (tab.draggable !== false)
                    startTabDrag(event.nativeEvent, tab.id, tab.group ?? 'left', tab.label);
                }}
                onClick={tab.open}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                  event.preventDefault();
                  const next =
                    tabs[
                      (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
                    ];
                  next.open();
                  requestAnimationFrame(() =>
                    host.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(),
                  );
                }}
              >
                {tab.settings ? <Icon name="settings" /> : <FileIcon path={tab.id} />}
                <span>{tab.label}</span>
              </Button>
              <Button
                variant="plain"
                size="icon-xs"
                type="button"
                className="mr-1 text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                tooltip="Close"
                aria-label={`Close ${tab.title}`}
                onClick={tab.close}
              >
                ×
              </Button>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
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
                <ContextMenuItem key={label} onSelect={action}>
                  {label}
                </ContextMenuItem>
              ))}
          </ContextMenuContent>
        </ContextMenu>
      )),
    );
}
