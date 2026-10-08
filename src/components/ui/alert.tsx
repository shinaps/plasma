import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
export function Alert({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn('relative w-full break-words text-caption text-destructive', className)}
      {...props}
    />
  );
}
