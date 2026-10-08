import { diffArrays } from 'diff';

type Line = { text: string; separator: string };
/** 採用した行。old / new は比較元・変更後での行番号 (0 始まり) で、その側に無い行では undefined。 */
type Chosen = { text: string; old?: number; new?: number };

/** 改行で分ける。separator はその行に続く改行で、最後の行では空。 */
function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const match of text.matchAll(/\r?\n/g)) {
    lines.push({ text: text.slice(start, match.index), separator: match[0] });
    start = match.index + match[0].length;
  }
  lines.push({ text: text.slice(start), separator: '' });
  return lines;
}

/**
 * UIの行差分と同じ連続した追加・削除を一単位とする。選択しない単位は比較元の内容を残す。
 * 行の区切りは、隣り合う行が比較元で連続していれば比較元の改行、そうでなければ変更後の改行を使う。
 * 改行コードだけを変えた変更は UI の行差分に現れず選べないので、選ばなかった行には混ぜない
 * (ファイル全体のコミットで含める)。
 * @param before 比較元 (HEAD) の全文
 * @param after 作業ツリーの全文
 * @param selected before→after の差分を先頭から数えた単位の 0 始まりの番号。範囲外や空なら例外を投げる
 */
export function selectedContent(before: string, after: string, selected: number[]): string {
  const left = splitLines(before);
  const right = splitLines(after);
  const parts = diffArrays(
    left.map((line) => line.text),
    right.map((line) => line.text),
    { timeout: 3000 },
  );
  if (!parts) throw new Error('Diff calculation timed out.');
  const chosen: Chosen[] = [];
  let old = 0;
  let next = 0;
  let index = 0;
  for (let i = 0; i < parts.length; ) {
    if (!parts[i].added && !parts[i].removed) {
      for (const text of parts[i++].value) chosen.push({ text, old: old++, new: next++ });
      continue;
    }
    const include = selected.includes(index++);
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      const part = parts[i++];
      for (const text of part.value) {
        if (part.removed) {
          if (!include) chosen.push({ text, old });
          old++;
        } else {
          if (include) chosen.push({ text, new: next });
          next++;
        }
      }
    }
  }
  if (!selected.length || selected.some((n) => n < 0 || n >= index))
    throw new Error('Select current changes before committing.');
  // 単位の境界は必ず共通行なので、隣り合う採用行は比較元か変更後のどちらかで連続している。
  return chosen
    .map((line, i) => {
      const previous = chosen[i - 1];
      if (!previous) return line.text;
      const separator =
        previous.old !== undefined && line.old === previous.old + 1
          ? left[previous.old].separator
          : previous.new !== undefined
            ? right[previous.new].separator
            : '';
      return separator + line.text;
    })
    .join('');
}
