import fs from 'node:fs';
import { imageType } from '../shared/image-types.ts';
import { limits, megabytes } from '../shared/limits.ts';

export const byteOrderMark = Buffer.from([0xef, 0xbb, 0xbf]);
export const hasByteOrderMark = (bytes: Buffer): boolean =>
  bytes.subarray(0, byteOrderMark.length).equals(byteOrderMark);

export const textTooLarge = `Files over ${megabytes(limits.textFile)} are not supported.`;
export const imageTooLarge = `Image preview supports files up to ${megabytes(limits.image)}.`;

/** 大きさを stat で確かめてから読む。上限を超えるファイルをメモリに読み込まない。 */
export function readBounded(file: string, limit: number, tooLarge: string): Buffer {
  if (fs.statSync(file).size > limit) throw new Error(tooLarge);
  return fs.readFileSync(file);
}

/** ディスクや Git から読んだバイト列を、表示できるテキストに変換する。大きすぎる・バイナリ・UTF-8 でないものは拒否する。 */
export function decodeText(bytes: Buffer): string {
  if (bytes.length > limits.textFile) throw new Error(textTooLarge);
  if (bytes.includes(0)) throw new Error('This file cannot be shown: binary content.');
  try {
    // BOM は取り除く。Monaco も先頭の BOM を落とすので、エディタの本文と同じ形で照合できる。ディスクに戻すのは save が行う。
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('This file cannot be shown: not UTF-8 text.');
  }
}

/**
 * 画像のバイト列を data URL にする。base64 は MCP の応答に載るので、大きさの上限を先に確かめる。
 * @param file 拡張子から画像の種類を判定するためのパス
 */
export function imageDataUrl(bytes: Buffer, file: string): string {
  const mime = imageType(file);
  if (!mime) throw new Error('Unsupported image format.');
  if (bytes.length > limits.image) throw new Error(imageTooLarge);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
