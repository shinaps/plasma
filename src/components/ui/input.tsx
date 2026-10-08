import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const classes =
  'flex h-9 w-full min-w-0 rounded-control border border-input bg-background px-3 py-1 text-body text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
export function Input({
  className,
  density = 'default',
  ...props
}: ComponentProps<'input'> & { density?: 'default' | 'compact' }) {
  return (
    <input
      data-slot="input"
      className={cn(classes, density === 'compact' && 'h-7 px-2 py-1 text-caption', className)}
      {...props}
    />
  );
}
