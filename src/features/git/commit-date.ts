/** 一覧・ツールチップ・詳細で同じ形式のローカル時刻を表示する。 */
export function formatCommitDate(value: string): string {
  const date = new Date(value);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
