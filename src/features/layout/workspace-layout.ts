import { requireElement } from '../../lib/dom';
import { getBottomPanelSpan, subscribeLayout } from './layout-state';

const dockSides = ['left', 'right', 'bottom'] as const;
export type DockSide = (typeof dockSides)[number];
export const isDockSide = (value: string | null | undefined): value is DockSide =>
  dockSides.some((side) => side === value);
/** ドックがワークスペースに占められる最大の割合。グリッドの制約とサイズ変更の上限の両方で使う。 */
export const dockLimits = { bottomHeight: 0.65, leftWidth: 0.3, rightWidth: 0.4 } as const;
export interface DockedPanel {
  readonly side: DockSide;
  readonly visible: boolean;
  readonly panel: HTMLElement;
  readonly separator: HTMLElement;
  setVisible(visible: boolean): void;
}
const panels = new Set<DockedPanel>();
export function registerPanel(panel: DockedPanel): void {
  panels.add(panel);
}
const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;
/**
 * ドックの配置をグリッドに反映する。列と行の番号は workspace-shell.tsx のグリッド線と対応している。
 * 列: 1 左レール, 2 サイドバー, 3 区切り, 4 左ドック, 5 区切り, 6 エディタ, 7 区切り, 8 右ドック, 9 右レール
 * 行: 1 本体, 2 区切り, 3 下ドック, 4 下レール
 */
export function updateLayout(active?: DockedPanel): void {
  if (active?.visible) {
    // 1 つのドックには 1 つのツールだけを表示する。隠すだけなのでセッションは終わらない。
    for (const other of panels) {
      if (other !== active && other.side === active.side && other.visible) other.setVisible(false);
    }
  }
  const workspace = requireElement('#workspace-grid');
  const span = getBottomPanelSpan();
  const left = span === 'left' || span === 'full';
  const right = span === 'right' || span === 'full';
  const has = (side: DockSide): boolean =>
    [...panels].some((panel) => panel.side === side && panel.visible);
  workspace.style.gridTemplateColumns = `2.5rem auto 0.5rem ${has('left') ? `min(var(--dock-left-width),${percent(dockLimits.leftWidth)}) 0.5rem` : '0 0'} minmax(0,1fr) ${has('right') ? `0.5rem min(var(--dock-right-width),${percent(dockLimits.rightWidth)})` : '0 0'} var(--right-rail-width)`;
  workspace.style.gridTemplateRows = has('bottom')
    ? `minmax(0,1fr) 0.5rem min(var(--dock-height),${percent(dockLimits.bottomHeight)}) var(--bottom-rail-height)`
    : 'minmax(0,1fr) 0 0 var(--bottom-rail-height)';
  for (const selector of ['#sidebar', '#resize'])
    requireElement(selector).style.gridRow = `1 / ${left ? 2 : 4}`;
  for (const panel of panels) {
    const column =
      panel.side === 'bottom'
        ? `${left ? 2 : 6} / ${right ? 9 : 7}`
        : panel.side === 'left'
          ? '4'
          : '8';
    const row =
      panel.side === 'bottom' ? '3' : `1 / ${(panel.side === 'left' ? left : right) ? 2 : 4}`;
    panel.panel.style.gridColumn = column;
    panel.panel.style.gridRow = row;
    panel.separator.style.gridColumn =
      panel.side === 'bottom' ? column : panel.side === 'left' ? '5' : '7';
    panel.separator.style.gridRow = panel.side === 'bottom' ? '2' : row;
  }
}
subscribeLayout(() => updateLayout());
