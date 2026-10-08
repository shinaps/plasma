import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const classes =
  'flex min-h-16 w-full rounded-control border border-input bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(classes, className)} {...props} />;
}
/** Imperative editor controllers share the same field appearance as React views. */
export function createTextarea(className?: string): HTMLTextAreaElement {
  const field = document.createElement('textarea');
  field.dataset.slot = 'textarea';
  field.className = cn(classes, className);
  return field;
}
