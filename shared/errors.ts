/** Node の fs や process が投げるエラーの `code` を取り出す。該当しなければ undefined。 */
export function errorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

/** 通知やログに出すための文言。Error 以外が投げられた場合は固定の文言にする。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unexpected error.';
}
