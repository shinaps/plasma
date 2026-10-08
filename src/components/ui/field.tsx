import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
export function Field({ className, ...props }: ComponentProps<'fieldset'>) {
  return (
    <fieldset
      data-slot="field"
      className={cn('m-0 min-w-0 border-0 p-0 flex items-center justify-between gap-6', className)}
      {...props}
    />
  );
}
export function FieldContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-content"
      className={cn('flex min-w-0 flex-1 flex-col', className)}
      {...props}
    />
  );
}
export function FieldDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('m-0 mt-1.5 text-caption leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}
