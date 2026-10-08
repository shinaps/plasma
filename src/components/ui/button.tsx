import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '../../lib/utils';
import { Tooltip } from './tooltip';

// shadcn/ui Buttonを既存トークンに合わせる。Preflightを使わないため余白は明示する。
const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-control border-0 p-0 transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-inverse text-inverse-foreground hover:bg-inverse/90',
        secondary: 'bg-accent text-foreground hover:bg-muted',
        ghost: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
        plain: 'bg-transparent text-inherit hover:bg-accent',
      },
      size: {
        default: 'h-9 gap-2 whitespace-nowrap px-4 py-2 text-body font-medium',
        sm: 'h-8 gap-2 whitespace-nowrap px-3 py-1.5 text-caption font-medium',
        icon: 'size-9',
        'icon-sm': 'size-7',
        'icon-xs': 'size-6',
        'icon-md': 'size-8',
        // 行・タブ・差分マーカーはホストが寸法と文字サイズを決める。
        content: '',
      },
    },
    compoundVariants: [
      {
        size: ['icon', 'icon-sm', 'icon-xs', 'icon-md'],
        className:
          'shrink-0 text-body [&_svg]:pointer-events-none [&_svg]:block [&_svg]:size-4 [&_svg]:shrink-0',
      },
    ],
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

// Tooltipは明示指定。DOMコントローラが動的に更新するtitleはネイティブ表示を保つ。
function Button({
  className,
  variant,
  size,
  type = 'button',
  tooltip,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { tooltip?: string }) {
  const button = (
    <button
      data-slot="button"
      type={type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
      title={tooltip ? undefined : props.title}
    />
  );
  return tooltip ? <Tooltip title={tooltip}>{button}</Tooltip> : button;
}

type DOMButtonOptions = VariantProps<typeof buttonVariants> & {
  className?: string;
  attributes?: Record<string, string | boolean>;
};

/** Monaco/xtermのDOM所有領域でも同じButtonスタイルを使い、マーカーごとのReactルートを作らない。 */
function createButton({
  variant = 'plain',
  size = 'content',
  className,
  attributes = {},
}: DOMButtonOptions = {}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.slot = 'button';
  button.className = cn(buttonVariants({ variant, size, className }));
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== false) button.setAttribute(name, value === true ? '' : value);
  }
  return button;
}

/** 固定のHTML雛形にも同じ生成経路を使う。ラベルはHTMLとして解釈しない。 */
function buttonHtml(options: DOMButtonOptions, label = ''): string {
  const button = createButton(options);
  button.textContent = label;
  return button.outerHTML;
}

export { Button, buttonHtml, buttonVariants, createButton };
