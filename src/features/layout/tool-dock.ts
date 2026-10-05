import { icon } from '../../lib/icons';
import { bottomPanelOptions, getBottomPanelSpan, setBottomPanelSpan } from './layout-state';
import {
  type DockSide,
  dockLimits,
  isDockSide,
  registerPanel,
  updateLayout,
} from './workspace-layout';

export type ToolDockOptions = {
  id: string;
  label: string;
  initialSide: DockSide;
  /** 既存のボタンを使う場合。無ければターミナルのアイコンでボタンを作る */
  button?: HTMLButtonElement;
  onHide?: () => void;
};
const labels: Record<DockSide, string> = { left: 'Left', bottom: 'Bottom', right: 'Right' };
const sizeKey = 'plasma.dock-size';
const sizeDimensions = ['left-width', 'right-width', 'height'] as const;
/** ドックの最小サイズ。これより小さいと内容が読めない。 */
const minimumSize = { height: 120, width: 220 };

/** 左右下のレールに置けるツールウィンドウ。ボタンのドラッグか Alt + 矢印キーで移動する。 */
export class ToolDock {
  readonly separator = document.createElement('div');
  readonly panel: HTMLElement;
  side: DockSide = 'right';
  visible = false;
  private readonly area: HTMLElement;
  private readonly options: ToolDockOptions;
  private button = document.createElement('button');
  private readonly preview = document.createElement('div');
  private readonly workspace: HTMLElement;
  private readonly rails: HTMLElement[];
  private drag?: { id: number; x: number; y: number; active: boolean; target?: HTMLElement };
  private suppressClick = false;
  constructor(area: HTMLElement, panel: HTMLElement, toggle: () => void, options: ToolDockOptions) {
    this.area = area;
    this.panel = panel;
    this.options = options;
    if (!area.parentElement) throw new Error('The dock area must be inside the workspace.');
    this.workspace = area.parentElement;
    this.preview.className =
      'pointer-events-none fixed z-50 rounded-panel bg-primary/20 ring-2 ring-ring';
    this.preview.hidden = true;
    this.workspace.append(this.preview);
    registerPanel(this);
    if (options.button) this.button = options.button;
    this.rails = Array.from(document.querySelectorAll<HTMLElement>('[data-dock-side]'));
    this.button.className = 'touch-none select-none';
    if (!options.button) this.button.append(icon('terminal'));
    this.button.setAttribute('aria-label', options.label);
    this.button.setAttribute('aria-controls', panel.id);
    this.button.title = `${options.label} · Drag to move (or use Alt + arrow keys)`;
    this.button.onclick = () => {
      if (!this.suppressClick) toggle();
    };
    this.button.onkeydown = (event) => {
      const side = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'bottom' }[event.key];
      if (event.altKey && isDockSide(side)) {
        event.preventDefault();
        this.move(side);
        this.button.focus();
      }
    };
    this.button.onpointerdown = (event) => {
      if (event.button !== 0) return;
      this.suppressClick = false;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false };
      this.button.setPointerCapture(event.pointerId);
    };
    this.panel.addEventListener('pointerdown', (event) => {
      const target = event.target as Element;
      if (target.closest('button,input,textarea,select,[role=tab]')) return;
      if (
        target.closest('header') ||
        target === this.panel.firstElementChild ||
        target.closest('[role=tablist]')
      ) {
        this.button.onpointerdown?.call(this.button, event);
      }
    });
    this.button.onpointermove = (event) => {
      const drag = this.drag;
      if (!drag) return;
      // 少し動かしてからドラッグとみなす。普通のクリックでパネルが動いたり開き直したりしない。
      if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      drag.active = true;
      this.suppressClick = true;
      document.body.classList.add('docking');
      drag.target = this.rails.find((rail) => {
        const bounds = rail.getBoundingClientRect();
        return (
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom
        );
      });
      for (const rail of this.rails) rail.classList.toggle('dock-target', rail === drag.target);
      const side = drag.target?.dataset.dockSide;
      this.showPreview(isDockSide(side) ? side : undefined);
    };
    const cancel = (): void => {
      this.drag = undefined;
      this.preview.hidden = true;
      document.body.classList.remove('docking');
      for (const rail of this.rails) rail.classList.remove('dock-target');
    };
    this.button.onpointerup = (event) => {
      const side = this.drag?.target?.dataset.dockSide;
      this.button.releasePointerCapture(event.pointerId);
      cancel();
      if (isDockSide(side)) this.move(side);
      // pointerup の後に合成されるクリックで、ドロップしたパネルが隠れないようにする。
      setTimeout(() => {
        this.suppressClick = false;
      }, 0);
    };
    this.button.onpointercancel = cancel;
    this.button.onlostpointercapture = cancel;
    this.separator.className =
      'relative z-10 cursor-col-resize touch-none bg-transparent after:absolute after:inset-y-2 after:inset-x-0.5 after:rounded-control hover:after:bg-ring data-[side=bottom]:cursor-row-resize data-[side=bottom]:after:inset-x-2 data-[side=bottom]:after:inset-y-0.5';
    this.separator.role = 'separator';
    this.separator.tabIndex = 0;
    this.separator.setAttribute('aria-label', `${options.label} size`);
    this.separator.onpointerdown = (event) => {
      if (event.button === 0) this.separator.setPointerCapture(event.pointerId);
    };
    this.separator.onpointermove = (event) => {
      if (!this.separator.hasPointerCapture(event.pointerId)) return;
      const bounds = this.panel.getBoundingClientRect();
      this.resize(
        this.side === 'bottom'
          ? bounds.bottom - event.clientY
          : this.side === 'right'
            ? bounds.right - event.clientX
            : event.clientX - bounds.left,
      );
    };
    this.separator.onpointerup = (event) => this.separator.releasePointerCapture(event.pointerId);
    this.separator.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const bounds = panel.getBoundingClientRect();
      const increase =
        this.side === 'bottom'
          ? event.key === 'ArrowUp'
          : this.side === 'right'
            ? event.key === 'ArrowLeft'
            : event.key === 'ArrowRight';
      this.resize((this.side === 'bottom' ? bounds.height : bounds.width) + (increase ? 20 : -20));
    };
    this.workspace.append(this.separator, panel);
    this.move(this.storedSide() ?? options.initialSide);
    for (const [dimension, size] of this.storedSizes())
      this.workspace.style.setProperty(`--dock-${dimension}`, `${size}px`);
    this.setVisible(false);
    this.installLayoutMenu();
  }
  private storedSide(): DockSide | undefined {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(`plasma.${this.options.id}-position`);
    } catch {
      // ストレージが使えない環境では初期位置を使う。
    }
    return isDockSide(stored) ? stored : undefined;
  }
  private storedSizes(): [string, number][] {
    let sizes: Record<string, unknown> = {};
    try {
      sizes = JSON.parse(localStorage.getItem(sizeKey) ?? '{}');
    } catch {
      // ストレージが使えないか、保存された値が壊れている。既定のサイズを使う。
    }
    return sizeDimensions.flatMap((dimension) => {
      const size = sizes[dimension];
      return typeof size === 'number' && Number.isFinite(size) && size > 0
        ? [[dimension, size]]
        : [];
    });
  }
  private showPreview(side?: DockSide): void {
    this.preview.hidden = !side;
    if (!side) return;
    const span = getBottomPanelSpan();
    const full = side === 'bottom';
    const bounds = (full ? this.workspace : this.area).getBoundingClientRect();
    const contentLeft =
      full && (span === 'left' || span === 'full')
        ? this.rails[0].getBoundingClientRect().right
        : this.area.getBoundingClientRect().left;
    const contentRight =
      full && (span === 'right' || span === 'full')
        ? bounds.right -
          (this.rails.find((rail) => rail.dataset.dockSide === 'right')?.getBoundingClientRect()
            .width ?? 0)
        : this.area.getBoundingClientRect().right;
    const size = (side === 'bottom' ? bounds.height : bounds.width) * 0.35;
    Object.assign(this.preview.style, {
      left: `${side === 'right' ? bounds.right - size : contentLeft}px`,
      top: `${side === 'bottom' ? bounds.bottom - size : bounds.top}px`,
      width: `${side === 'bottom' ? contentRight - contentLeft : size}px`,
      height: `${side === 'bottom' ? size : bounds.height}px`,
    });
  }
  private installLayoutMenu(): void {
    const menu = document.createElement('div');
    menu.popover = 'auto';
    menu.className =
      'fixed m-0 rounded-control border-0 bg-popover p-1 text-caption text-popover-foreground shadow-popover';
    for (const [value, label] of bottomPanelOptions) {
      const item = document.createElement('button');
      item.textContent = label;
      item.className = 'block w-full rounded-control px-3 py-2 text-left hover:bg-accent';
      item.onclick = () => {
        setBottomPanelSpan(value);
        menu.hidePopover();
      };
      menu.append(item);
    }
    document.body.append(menu);
    this.panel.addEventListener('contextmenu', (event) => {
      if (this.side !== 'bottom' || !(event.target as Element).closest('header, [role=tablist]'))
        return;
      event.preventDefault();
      menu.showPopover();
      menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
      menu.querySelector('button')?.focus();
    });
  }
  private move(side: DockSide): void {
    this.side = side;
    this.place();
    this.separator.dataset.side = side;
    const rail = this.rails.find((candidate) => candidate.dataset.dockSide === side);
    if (!rail) throw new Error(`Missing tool dock: ${side}`);
    rail.append(this.button);
    this.button.setAttribute(
      'aria-description',
      `${labels[side]} dock. Use Alt + Left, Down, or Right to move.`,
    );
    this.separator.setAttribute('aria-orientation', side === 'bottom' ? 'horizontal' : 'vertical');
    this.updateSizeAttributes();
    try {
      localStorage.setItem(`plasma.${this.options.id}-position`, side);
    } catch {
      // ストレージに書けなくても、この画面の間は位置を保つ。
    }
  }
  private place(): void {
    updateLayout(this);
  }
  private maximumSize(): number {
    const bounds = this.workspace.getBoundingClientRect();
    return this.side === 'bottom'
      ? bounds.height * dockLimits.bottomHeight
      : bounds.width * (this.side === 'left' ? dockLimits.leftWidth : dockLimits.rightWidth);
  }
  private updateSizeAttributes(): void {
    const vertical = this.side === 'bottom';
    const bounds = this.panel.getBoundingClientRect();
    this.separator.setAttribute(
      'aria-valuemin',
      String(vertical ? minimumSize.height : minimumSize.width),
    );
    this.separator.setAttribute('aria-valuemax', String(Math.round(this.maximumSize())));
    this.separator.setAttribute(
      'aria-valuenow',
      String(Math.round(vertical ? bounds.height : bounds.width)),
    );
  }
  private resize(size: number): void {
    const vertical = this.side === 'bottom';
    const maximum = this.maximumSize();
    const minimum = Math.min(vertical ? minimumSize.height : minimumSize.width, maximum);
    const value = Math.round(Math.max(minimum, Math.min(maximum, size)));
    this.workspace.style.setProperty(
      vertical ? '--dock-height' : `--dock-${this.side}-width`,
      `${value}px`,
    );
    const sizes = Object.fromEntries(
      sizeDimensions.map((dimension) => [
        dimension,
        Number.parseFloat(this.workspace.style.getPropertyValue(`--dock-${dimension}`)),
      ]),
    );
    try {
      localStorage.setItem(sizeKey, JSON.stringify(sizes));
    } catch {
      // ストレージに書けなくても、この画面の間はサイズを保つ。
    }
    this.updateSizeAttributes();
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.place();
    this.panel.hidden = !visible;
    this.separator.hidden = !visible;
    this.button.classList.toggle('active', visible);
    this.button.setAttribute('aria-expanded', String(visible));
    if (visible) this.updateSizeAttributes();
    if (!visible) this.options.onHide?.();
  }
}
