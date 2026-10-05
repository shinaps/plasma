/**
 * リクエスト本文をバイト列のまま集めてから 1 回だけ文字列にする。
 * かたまりごとに変換すると、境目で切れた複数バイト文字が壊れる。
 * @param limit 本文のバイト数の上限。超えた時点で読むのをやめる
 */
export async function readBody(stream: AsyncIterable<Buffer>, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > limit) throw new Error('Request too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
