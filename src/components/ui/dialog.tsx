import * as Primitive from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
export const Dialog = Primitive.Root;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-background/70" />
      <Primitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-96 max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-panel border-0 bg-popover p-5 text-popover-foreground shadow-popover outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}
