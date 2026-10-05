const types = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
} as const satisfies Record<string, string>;

/** 画像として扱う拡張子なら MIME type を返す。 */
export function imageType(file: string): string | undefined {
  const extension = file.split('.').at(-1)?.toLowerCase() ?? '';
  return Object.hasOwn(types, extension) ? types[extension as keyof typeof types] : undefined;
}
