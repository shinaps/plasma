import { z } from 'zod';

const fontSize = z.number().int().min(10).max(32);
// 値がないフィールドはデザイントークンの既定値を使う。「標準に戻す」は全フィールドを消す。
// 未知のキーは取り除く。新しい版が項目を足した設定ファイルを古い版でも読めるようにするため。
export const appearanceSchema = z.object({
  wordWrap: z.boolean().optional(),
  ui: fontSize.optional(),
  editor: fontSize.optional(),
  terminal: fontSize.optional(),
});
export type Appearance = z.infer<typeof appearanceSchema>;
