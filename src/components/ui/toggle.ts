import { buttonHtml } from './button';

export const toggleClassName =
  'inline-flex size-7 items-center justify-center rounded-control border-0 bg-transparent p-0 text-muted-foreground hover:bg-accent data-[state=on]:bg-accent data-[state=on]:text-foreground focus-visible:outline-ring [&_svg]:size-4';
/** Imperative diff toolbars keep their DOM ownership and share the Toggle state/styles. */
export function toggleHtml(attributes: Record<string, string | boolean>): string {
  return buttonHtml({
    className: toggleClassName,
    attributes: {
      ...attributes,
      'data-slot': 'toggle',
      'data-state': 'off',
      'aria-pressed': 'false',
    },
  });
}
export function setTogglePressed(button: HTMLElement, pressed: boolean): void {
  button.setAttribute('aria-pressed', String(pressed));
  button.dataset.state = pressed ? 'on' : 'off';
}
