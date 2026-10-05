'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import type * as React from 'react';
import { cn } from '../../lib/utils';

// Monaco と xterm のために preflight を無効にしているので、ボタンの余白と枠線をここで消す。
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer group/switch inline-flex shrink-0 items-center p-0 rounded-full border-[3px] border-solid border-transparent shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-[22px] w-[36px] data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block rounded-full bg-foreground ring-0 transition-transform size-[16px] data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
