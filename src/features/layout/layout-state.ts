/** 下ドックがどの列まで広がるか。editor はエディタ列だけ、left / right はそのサイドバーまで、full は全幅。 */
export const bottomPanelOptions = [
  ['editor', 'Editor Only'],
  ['left', 'Include Left Sidebar'],
  ['right', 'Include Right Sidebar'],
  ['full', 'Full Width'],
] as const;
export type BottomPanelSpan = (typeof bottomPanelOptions)[number][0];
// 保存キーは旧名のまま。変えると保存済みの設定が読めなくなる。
const key = 'plasma.bottom-panel-width';
const listeners = new Set<() => void>();
let span: BottomPanelSpan = 'editor';
const isBottomPanelSpan = (value: string | null): value is BottomPanelSpan =>
  bottomPanelOptions.some(([option]) => option === value);
try {
  const stored = localStorage.getItem(key);
  if (isBottomPanelSpan(stored)) span = stored;
} catch {
  // ストレージが使えない環境 (プライベートモードや埋め込み) では既定値のまま始める。
}
export const getBottomPanelSpan = (): BottomPanelSpan => span;
export function subscribeLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function setBottomPanelSpan(next: BottomPanelSpan): void {
  span = next;
  try {
    localStorage.setItem(key, next);
  } catch {
    // ストレージに書けなくても、この画面の間は設定を使う。
  }
  for (const listener of listeners) listener();
}
