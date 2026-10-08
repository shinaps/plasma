import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
export function Badge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="badge"
      className={cn(
        'inline-flex min-w-0 items-center rounded-control bg-muted px-1.5 py-0.5 text-caption text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
