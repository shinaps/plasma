import { type ReactNode, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

// 命令的なコントローラが空の要素に内容を描くための仕組み。要素の子は React だけが持つ。
// ポータルを 1 つのルートにまとめるので、どの画面も同じ React のコンテキストを共有する。
let views = new Map<HTMLElement, { id: number; content: ReactNode }>();
let nextId = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function ReactViews() {
  const current = useSyncExternalStore(subscribe, () => views);
  return (
    <>{Array.from(current, ([host, view]) => createPortal(view.content, host, String(view.id)))}</>
  );
}
export function renderReact(host: HTMLElement, content: ReactNode): void {
  views = new Map(views).set(host, { id: views.get(host)?.id ?? nextId++, content });
  for (const listener of listeners) listener();
}
export function unmountReact(host: HTMLElement): void {
  views = new Map(views);
  views.delete(host);
  for (const listener of listeners) listener();
}
