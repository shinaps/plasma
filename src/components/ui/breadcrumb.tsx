import { ChevronRight } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
export function Breadcrumb(props: ComponentProps<'nav'>) {
  return <nav aria-label="Breadcrumb" {...props} />;
}
export function BreadcrumbList({ className, ...props }: ComponentProps<'ol'>) {
  return (
    <ol
      className={cn(
        'm-0 flex min-w-0 list-none items-center gap-1 overflow-hidden p-0 text-caption text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
export function BreadcrumbItem({ className, ...props }: ComponentProps<'li'>) {
  return <li className={cn('inline-flex shrink-0 items-center gap-1', className)} {...props} />;
}
export function BreadcrumbSeparator() {
  return (
    <li role="presentation" aria-hidden="true" className="inline-flex">
      <ChevronRight className="size-3" />
    </li>
  );
}
