export type EditorGroup = 'left' | 'right';
type DropHandler = (path: string, source: EditorGroup, target: EditorGroup) => void;
let onDrop: DropHandler;
let container: HTMLElement;
let rightPane: HTMLElement;
/**
 * タブのドラッグで文書を左右のエディタ間で移す。
 * @param containerElement 2 つのエディタを並べる要素。ドロップ先の判定に使う
 * @param rightPaneElement 分割ペインの要素。左右分割では表示中ならその左端、非表示なら中央を境にする。上下分割ではその上端を境にする
 * @param dropHandler ドロップ先が元と違うときに呼ぶ
 */
export function configureTabDrag(
  containerElement: HTMLElement,
  rightPaneElement: HTMLElement,
  dropHandler: DropHandler,
): void {
  container = containerElement;
  rightPane = rightPaneElement;
  onDrop = dropHandler;
}
export function startTabDrag(event: PointerEvent, path: string, source: EditorGroup): void {
  if (event.button !== 0) return;
  const origin = { x: event.clientX, y: event.clientY };
  let dragging = false;
  let target: EditorGroup | undefined;
  const preview = document.createElement('div');
  preview.className = 'pointer-events-none fixed z-50 rounded-panel bg-primary/20 ring-2 ring-ring';
  preview.hidden = true;
  const label = document.createElement('div');
  label.className =
    'pointer-events-none fixed z-[60] max-w-xs truncate rounded-control bg-popover px-3 py-2 text-caption text-popover-foreground shadow-popover';
  label.textContent = path.split('/').at(-1) ?? path;
  label.hidden = true;
  document.body.append(preview, label);
  const move = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId !== event.pointerId) return;
    if (!dragging && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 6)
      return;
    dragging = true;
    label.hidden = false;
    // ラベルはポインタの横に置き、ドロップ先の外でも画面内に収める。
    label.style.left = `${Math.max(8, Math.min(moveEvent.clientX + 16, innerWidth - label.offsetWidth - 8))}px`;
    label.style.top = `${Math.max(8, Math.min(moveEvent.clientY + 16, innerHeight - label.offsetHeight - 8))}px`;
    const bounds = container.getBoundingClientRect();
    const down = container.dataset.splitDirection === 'down';
    const paneBounds = rightPane.getBoundingClientRect();
    const divider = down
      ? paneBounds.top
      : rightPane.hidden
        ? bounds.left + bounds.width / 2
        : paneBounds.left;
    target =
      moveEvent.clientX < bounds.left ||
      moveEvent.clientX > bounds.right ||
      moveEvent.clientY < bounds.top ||
      moveEvent.clientY > bounds.bottom
        ? undefined
        : (down ? moveEvent.clientY : moveEvent.clientX) < divider
          ? 'left'
          : 'right';
    preview.hidden = !target;
    if (!target) return;
    Object.assign(preview.style, {
      left: `${down || target === 'left' ? bounds.left : divider}px`,
      top: `${down && target === 'right' ? divider : bounds.top}px`,
      width: `${down ? bounds.width : target === 'left' ? divider - bounds.left : bounds.right - divider}px`,
      height: `${down ? (target === 'left' ? divider - bounds.top : bounds.bottom - divider) : bounds.height}px`,
    });
    moveEvent.preventDefault();
  };
  const finish = (finishEvent: PointerEvent): void => {
    if (finishEvent.pointerId !== event.pointerId) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    preview.remove();
    label.remove();
    if (!dragging) return;
    // ドロップの直後に発生するクリックを止める。元のタブが開き直るのを防ぐ。
    const suppress = (click: MouseEvent): void => {
      click.preventDefault();
      click.stopImmediatePropagation();
    };
    window.addEventListener('click', suppress, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', suppress, true), 0);
    if (finishEvent.type === 'pointerup' && target && target !== source)
      onDrop(path, source, target);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}
