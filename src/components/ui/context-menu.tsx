import * as Primitive from '@radix-ui/react-context-menu';
import { ChevronRight } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react';
import { renderReact } from '../../lib/react-view';
import { cn } from '../../lib/utils';
export const ContextMenu = Primitive.Root;
const surface =
  'z-50 min-w-52 max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto max-w-[calc(100vw-16px)] rounded-control border-0 bg-popover p-1 text-caption text-popover-foreground shadow-popover';
const item =
  'flex cursor-default select-none items-center justify-between gap-6 rounded-control px-3 py-1.5 outline-none data-[highlighted]:bg-accent data-[disabled]:text-muted-foreground data-[disabled]:pointer-events-none';
export function ContextMenuTrigger({
  onKeyDown,
  ...props
}: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      {...props}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
        )
          return;
        event.preventDefault();
        // macOS の埋め込みブラウザは Shift+F10 から contextmenu を生成しない。
        const bounds = event.currentTarget.getBoundingClientRect();
        event.currentTarget.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: bounds.left + 16,
            clientY: bounds.bottom,
          }),
        );
      }}
    />
  );
}
export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content collisionPadding={8} className={cn(surface, className)} {...props} />
    </Primitive.Portal>
  );
}
export function ContextMenuItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item className={cn(item, className)} {...props} />;
}
export function ContextMenuSeparator() {
  return <Primitive.Separator className="mx-1 my-1 h-px bg-border" />;
}
export function ContextMenuSubmenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Primitive.Sub>
      <Primitive.SubTrigger className={item}>
        {label}
        <ChevronRight className="size-4" />
      </Primitive.SubTrigger>
      <Primitive.Portal>
        <Primitive.SubContent sideOffset={2} collisionPadding={8} className={surface}>
          {children}
        </Primitive.SubContent>
      </Primitive.Portal>
    </Primitive.Sub>
  );
}

/** Monaco/terminal controllers own their headers; the menu still uses the same Radix lifecycle. */
export function attachContextMenu(
  target: HTMLElement,
  accepts: (event: MouseEvent) => boolean,
  items: { label: string; select: () => void }[],
): void {
  const host = document.createElement('span');
  target.append(host);
  renderReact(host, <ExternalContextMenu target={target} accepts={accepts} items={items} />);
}
function ExternalContextMenu({
  target,
  accepts,
  items,
}: {
  target: HTMLElement;
  accepts: (event: MouseEvent) => boolean;
  items: { label: string; select: () => void }[];
}) {
  const trigger = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const open = (event: MouseEvent) => {
      if (event.target === trigger.current || !accepts(event)) return;
      event.preventDefault();
      trigger.current?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      );
    };
    target.addEventListener('contextmenu', open);
    return () => target.removeEventListener('contextmenu', open);
  }, [target, accepts]);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span ref={trigger} aria-hidden="true" />
      </ContextMenuTrigger>
      <ContextMenuContent>
        {items.map((item) => (
          <ContextMenuItem key={item.label} onSelect={item.select}>
            {item.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
