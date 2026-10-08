import * as Primitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
export function Checkbox({ className, checked, ...props }: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      data-slot="checkbox"
      checked={checked}
      className={cn(
        'peer inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-solid border-input bg-transparent hover:bg-accent p-0 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=checked]:bg-accent data-[state=indeterminate]:bg-accent',
        className,
      )}
      {...props}
    >
      <Primitive.Indicator className="flex items-center justify-center">
        {checked === 'indeterminate' ? <Minus className="size-3" /> : <Check className="size-3" />}
      </Primitive.Indicator>
    </Primitive.Root>
  );
}
