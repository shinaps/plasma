import * as Primitive from '@radix-ui/react-toggle-group';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
import { toggleClassName } from './toggle';
export function ToggleGroup({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root className={cn('flex items-center gap-1', className)} {...props} />;
}
export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  // Toggleのdata-stateは選択状態を表す。Tooltip.Triggerと同じDOMに重ねない。
  return <Primitive.Item className={cn(toggleClassName, className)} {...props} />;
}
