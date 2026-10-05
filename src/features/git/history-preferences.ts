import { z } from 'zod';

const preferences = z.object({
  revisions: z.array(z.string()).max(64),
  compareRef: z.string(),
});
type Preferences = z.infer<typeof preferences>;
const key = (root: string): string => `plasma.history-view:${root}`;

export function readHistoryPreferences(root: string): Preferences {
  try {
    return preferences.parse(JSON.parse(localStorage.getItem(key(root)) ?? 'null'));
  } catch {
    return { revisions: [], compareRef: '' };
  }
}

export function saveHistoryPreferences(root: string, value: Preferences): void {
  try {
    localStorage.setItem(key(root), JSON.stringify(value));
  } catch {
    // 埋め込み環境で保存できなくても、表示中の選択は使える。
  }
}
