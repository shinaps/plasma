/** サーバーとクライアントが共有するサイズ上限。値を変えるときは両側の挙動が同時に変わる。 */
export const limits = {
  /** 表示・編集・差分の対象にするテキストの上限。これを超えるとエディタの応答が目に見えて遅くなる。 */
  textFile: 2 * 1024 * 1024,
  /** base64 にして MCP の応答に載せる画像の上限。 */
  image: 10 * 1024 * 1024,
  /** HTTP の 1 リクエストの上限。未保存の 2 MB ファイルが複数あっても 1 回の sync で送れる余裕を持たせる。 */
  requestBody: 16 * 1024 * 1024,
  /** git の出力 (show / status / log) の上限。textFile を超える blob も読み切ってから拒否する。 */
  gitOutput: 16 * 1024 * 1024,
  /** terminal-write 1 回の上限。xterm の貼り付けは 1 回の書き込みになる。 */
  terminalWrite: 65536,
  /** terminal-read 1 回で返す文字数。100 ms 間隔の取得で前面タブの出力に追従できる量。 */
  terminalReadChunk: 65536,
  /** セッションごとに保持する出力の上限。超えた分は古い側から削除する。 */
  terminalScrollback: 1024 * 1024,
  /** git-history の検索語の上限。 */
  historyQuery: 500,
} as const;

/** エラー文に出す大きさ。上限を変えても文言がずれない。 */
export const megabytes = (bytes: number): string => `${bytes / 1024 / 1024} MB`;
