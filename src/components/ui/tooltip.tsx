import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  children,
  title,
  description,
}: {
  children: ReactElement;
  title: string;
  description: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      {/* Escape sidebar overflow; Radix shifts the content within the viewport. */}
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 w-60 max-w-[var(--radix-tooltip-content-available-width)] rounded-control bg-popover p-3 text-caption leading-relaxed text-popover-foreground shadow-popover"
        >
          <strong className="mb-1 block">{title}</strong>
          <span className="block text-muted-foreground">{description}</span>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
