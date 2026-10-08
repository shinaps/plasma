import * as Primitive from '@radix-ui/react-popover';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export function PopoverContent({
  className,
  align = 'end',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-50 w-72 max-h-[var(--radix-popover-content-available-height)] overflow-auto rounded-control bg-popover p-2 text-popover-foreground shadow-popover outline-none',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
