# Plasma — prototype

Codexの会話の横で使う、TypeScript向けの小さな開発画面です。Monaco EditorとTypeScript Language Serviceを使い、実ファイルを扱います。

## 別のPCにインストール

macOS、Node.js 24.3以降、pnpm 11.19.0、Git、CodexデスクトップとCodex CLIが必要です。Linux・Windowsは未検証です。

```sh
git clone https://github.com/shinaps/plasma.git
cd plasma
pnpm install --frozen-lockfile
pnpm run build
pnpm run setup:plugin
codex plugin marketplace add "$PWD/.shinaps/work/local-marketplace"
codex plugin add typescript-workbench@workbench-local
```

Codexを再起動してPlasmaを開き、使いたいプロジェクトを選択します。GitHubで配布するのはPlasma本体で、開くコードやターミナルはそのPC上で動作します。公式ディレクトリ掲載とは別のローカルインストールです。

登録後もcloneしたフォルダを残してください。Nodeやフォルダの場所を変えた場合は設定の再生成・再登録が必要です。同じ `workbench-local` が登録済みなら、旧インストールの場所を確認してから切り替えてください。

更新は、Plasmaのフォルダで次を実行した後にCodexを再起動します。設定や実行パスが変更された版ではプラグインの再登録も必要です。

```sh
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run build
pnpm run setup:plugin
```

## 起動

Node.js 24以降で、プロジェクトルートから実行します。

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm start
```

表示された `http://127.0.0.1:…/#…` をCodexの内蔵ブラウザで開きます。起動時の引数は受け付けません。

起動するとプロジェクト選択画面が開きます。フォルダのパスを入力するか、フォルダ一覧・最近開いたプロジェクトから選択してください。プロジェクトは画面ごとに選択し、ファイル操作とターミナルはプロジェクト別に分離します。最近の一覧は ~/.config/typescript-workbench/projects.json に保存します。終了は起動したターミナルでCtrl+C。再起動すると接続URLが変わります。外部サービスやモデルAPIへの通信はありません。

## できること

- ルート全体の階層ツリー（空フォルダを含む）、検索、閉じられるタブでの編集。Markdown・設定ファイルも表示
- Projectツリーは単クリック・Enterで開く。矢印キー、全折りたたみ、現在ファイルの表示、幅調整
- Projectツリーの右クリックからファイル・フォルダの作成、改名、Cut/Copy/Paste、永久削除。名前の衝突では上書きせず、未保存の対象は保存してから操作。Copy Pathは絶対・プロジェクト相対・ファイル名を選択可能
- Reload from Disk、Git → Show Diff、Mark Directory As → Excluded / Include in Analysis
- 種類別アイコンとGit状態によるファイル・フォルダ名の色分け。Gitでignoreされている項目はグレー、解析除外は紫（両方なら紫を優先）。ツールチップに両方の状態を表示
- Git変更一覧はChanges／Unversioned Filesに分けた階層ツリー。単一の子フォルダはパスをまとめ、フォルダごとの件数と折りたたみに対応
- Git変更一覧と左右比較（HEAD→ディスク）。差分の前後移動、左右同時の折り返しトグル（Markdownは初期ON、明示した選択は画面を開いている間保持）
- チェックしたファイルのコミットと、差分単位を選ぶ部分コミット。部分コミットは一時 index で選んだ行だけを格納し、作業ツリーと未選択のステージ内容を保つ。改行コードだけの変更は差分に現れないので部分コミットに含まれず、ファイル全体のコミットで含める。マージ・cherry-pick・revert の途中はどちらのコミットも拒否する。ブランチの切り替え（上書きになる変更があれば Git が拒否）、`gh` によるプルリクエストの閲覧（読み取り専用）
- 下部の「Git History」では複数のブランチ・タグをチェックして同じグラフに表示。「Compare with」で比較元を選び、未反映のコミットを「Branch only」、比較元の先端を「Base tip」で区別する。初期表示は HEAD と既定ブランチで、選択はプロジェクトごとに保存。「Reset」で初期表示に戻る。リモートはローカルに取得済みの情報を使用し、自動 fetch は行わない。件数は検索・フォルダの絞り込みによらずリポジトリ全体の比較。メッセージ検索、変更ファイルと過去の差分を表示でき、パネルの高さは上端をドラッグして変更可能。マージは第1親と比較し、過去のコードの行参照は自動共有しない
- 「Go to Definition」/ F12、「Peek Definition」/ ⌥F12（Peek 内で編集するとそのファイルがタブとして開く）、「Find References」、「Back」でジャンプ履歴を戻る
- 型ホバーと「Show Type」。プロジェクト内のシンボルが対象
- 未保存のバッファを含む型診断と、診断から該当行へのジャンプ。Problems パネルはタブ列右の件数ボタンか ⇧⌘M で開閉
- 保存（全オープンファイル）/ Cmd+S。設定 → On Save の Format on Save を有効にすると、TypeScript・JavaScript はプロジェクトにある整形器（Vite+・Biome・Oxfmt）で整形してから保存
- 外部から変更された開いているファイルを2秒間隔で反映。未保存の場合は競合として保持
- 保存前のリビジョン照合による上書き防止
- 選択したコードをファイル名・行番号付きでコピーして会話に貼り付け

`demo/src/main.ts` の `calculateTotal` にカーソルを置き「Go to Definition」を押すと、`pricing.ts` に移動します。「Find References」でテストを含む呼び出し元を表示します。

## Plugin Extensions版

同じUIと解析処理を使うstdio MCPサーバーを `server/mcp.ts` に実装しています。

```sh
pnpm run mcp
```

MCPクライアントに設定する実行コマンドは `node`、引数は `server/mcp.ts` の絶対パスです。対象プロジェクトは画面で選びます。Node 24 はサーバーの `.ts` を型を取り除いてそのまま実行しますが、UIには事前の `pnpm run build` が必要です。プラグイン設定の生成時に実行中のNodeの絶対パスを登録します。

- `open_workbench` は会話パネルとグローバルのentrypointを宣言
- `ui://plasma/editor` は単一HTMLのMCP App
- `workbench_request` はUI専用の操作ツール
- ホストがModel-App Contextを提供する場合、選択コードを会話のコンテキストに共有
- `scripts/prepare-local-plugin.ts` がローカルプラグイン定義を生成

内蔵ブラウザとMCP接続・UIリソース・ツール呼び出しは自動または実画面で検証します。Sidebar appはユーザーによる起動確認済みです。

## 境界

- WebStorm全機能の代替ではありません。補完、リネームリファクタリング、デバッガ、ステージ操作（index の編集）、push・pull・マージは未実装
- 解析は同梱TypeScript 5.9.3。プロジェクト固有のTypeScriptバージョン、Vue/Svelteは未対応
- 開いたソースに最も近い `tsconfig.json` を利用。診断の範囲もそのプロジェクト単位。`references` だけの設定（Vite の solution 形式）では、そのファイルを含む参照先の設定で解析する。`tsconfig.json` が無い場合は、ルート以下のソース全体を既定の設定で解析する
- `.git` の中身はテキストとして表示・編集できるが、作成・改名・移動・削除はツリーから行えない。自動の `git status` は、開いたリポジトリの `.git/config` にある `core.fsmonitor` と `filter` のコマンドを実行しない（グローバル設定の filter は使う）
- `node_modules`・`.git`・`dist`・`build`・`.build`・`DerivedData`・`.next`・`.turbo`・`.cache`・`.shinaps` は初期設定でツリーから除外。Settings → Files の Hidden Files and Folders でプロジェクトごとに変更でき、保存するとツリーとファイル検索へ反映する。1行に1つ、任意の階層のフォルダ名またはファイル・フォルダのプロジェクト相対パスを指定する（ワイルドカード非対応）。`./` 付きのパスはその場所だけに一致する。ツリーの右クリック → Exclude from Analysis は選んだファイル・フォルダを表示・編集できるまま解析から除外する。Excluded from Analysis の一覧で管理し、診断・ホバー・定義・参照検索の対象から外す。ほかのファイルの型解決に必要なimport先は読み込む場合がある。解除は設定の一覧から対象行を削除して保存する。空欄なら除外なし。表示の除外と解析の除外は独立し、Git・フォーマッターの設定は変更しない。シンボリックリンクは列挙しない
- 表示・編集は2 MB以下のUTF-8テキスト。バイナリは一覧のみ
- 型診断は未保存の編集内容も含めて実行
- Git差分の右側はエディタと同じ編集中の本文（未保存の編集を含む）。左側（HEAD／index）は5秒ごとの一覧更新で再取得。ファイル一覧の追加・削除はサイドバーの更新ボタンで反映。競合の3-wayマージとバイナリ差分は未対応
- 1セッション用。複数タブ・複数ユーザー間で編集状態は分離しない
- 保存時に、読み込んだ後でディスク上のファイルが変わっていないかを確かめる。ファイルのロックはしない。保存は同じフォルダの一時ファイルに書き切ってから置き換える（ハードリンクされたファイルと一時ファイルを作れないフォルダでは上書き）
- 起動したルート外への編集とシンボリックリンクによる脱出を拒否。解析エンジンは型解決のため依存パッケージを読む
- HTTP版は 127.0.0.1 だけで待ち受け、起動ごとのトークンとOrigin/Host照合で保護

## 開発と検証

```sh
pnpm run typecheck
pnpm run build
pnpm test
```

サーバー・共有コード・スクリプト・テストも TypeScript で書き、Node 24 の型消去でそのまま実行します (`enum` や parameter properties は使えないため、`erasableSyntaxOnly` で検査します)。相対 import は `.ts` の拡張子まで書きます。`pnpm run typecheck` は `tsc -b` で、ブラウザ側 (`tsconfig.app.json`) と Node 側 (`tsconfig.node.json`) を別々に検査します。

`shared/protocol.ts` がクライアントとサーバーの契約です。操作ごとの入力は zod の schema で、応答は型で表し、`Projects.dispatch` の入口で 1 回だけ検証します。`server/workspace.ts` が解析・ファイル操作、`server/http.ts` と `server/mcp.ts` が接続口、`src/main.ts` が起動口、`src/app/` が画面全体の組み立てです。`src/features/explorer/` がツリー操作、`src/features/git/` が差分表示とコミット、`server/git.ts` と `server/partial-commit.ts` が Git アクセスを担当します。

画面の文言と通知は英語、コードのコメントとこの文書は日本語で書きます。

外観は One Dark (ISC) の標準配色をMonaco向けに対応付け、Atom Material Icons (MIT) のファイル・フォルダSVGを使用。出典・ライセンスは `src/features/editor/themes/` と `src/assets/atom-material/` に保持。各IDEの拡張そのものや設定画面を実行するものではありません。

## 注釈とローカルプラグイン

他の端末向けのローカル配布候補は `pnpm run package:local` で生成する。出力は `.shinaps/work/distribution/` 以下で、ビルド済みUI・サーバー・lockfile・第三者ライセンスを含む。展開先で依存関係を導入して設定を生成するため、開発者の絶対パスは配布しない。これは公式掲載済みパッケージではない。導入方法は [配布候補のREADME](docs/local-distribution.md) を参照。

ファイルはワンクリックで開く。コード選択は自動共有し、右クリックの「Add Comment」で注釈入力・行の参照のコピーができる。プラグインホストが対応する場合だけ「Send」(会話へ送信) が有効になる。注釈の対象は入力開始時に固定され、差分では右側（作業中のコード）だけを共有対象にする。入力欄の外をクリックすると欄は隠れるが書きかけは残り、同じ対象で再び「Add Comment」を選ぶと戻る。Escape で破棄する。入力内容はメモリ内のみ。

プラグインでは現在のファイルパスと選択行範囲を Model-App Context へ共有する。コード本文・内容ハッシュ・変更検知は使用しない。選択範囲は会話の入力欄へ添付する。音声通話用の選択取得ツールや定期更新は持たない。

開発用ローカルプラグインの準備:

```sh
node scripts/prepare-local-plugin.ts
codex plugin marketplace add /absolute/path/to/plasma/.shinaps/work/local-marketplace
codex plugin add typescript-workbench@workbench-local
```

開発用設定はこのチェックアウトのサーバーを直接参照する。配布用パッケージではない。Codex 0.160.0 で接続先を検出できる `.codex-plugin/plugin.json` と `.mcp.json` を生成する。インストール済みの表示だけでなく、app-server の `plugin/read` で `mcpServers`、`mcpServerStatus/list` で `open_workbench` とUIリソースを確認する。プラグインとMCPサーバーの表示名は「Plasma」。既存のインストールを保つため、プラグインIDだけは `typescript-workbench@workbench-local` を維持する。

### Sidebar appの起動

この環境で起動を確認したリンク:

`codex://mcp-app/typescript-workbench@workbench-local/open_workbench`

`codex://plugins/typescript-workbench@workbench-local/app/open_workbench` は、このチャットからクリックするとプラグイン詳細へ遷移した。上記の `mcp-app` 形式ではユーザーがコード画面の表示を確認し、デスクトップログでも `/mcp-app/typescript-workbench/open_workbench` と `workbench_request` の成功を確認した。localhostのブラウザ表示とは別の、ネイティブMCP Appとしての起動。

サイドバーの表示名はentrypointのツールタイトル「Plasma」。

### 内蔵ターミナル

ターミナルの「＋」で、対象プロジェクトを作業ディレクトリとする新しいログインシェルを追加します。各タブの入力・出力・プロセスは独立しています。タブの「×」は、そのシェルと子プロセスを終了し、入力・出力バッファを破棄します。「−」やツールアイコンで隠す場合はタブを維持します。シェルが終了したタブは出力を残して「Exited」と表示します。新しいシェルは「＋」から作成してください。

同じサーバーに再接続すると、削除していないタブを復元します。サーバー終了時はすべてのタブを終了します。xterm.js と node-pty を使用し、HTTP と MCP で同じ操作を扱います。

シェルから claude / codex を起動できます。選択したコードは自動ではターミナルに送りません。右クリックの「Send Selection to Terminal」(Option+Command+K) か、注釈パネルの「Send to Terminal」で、表示中のタブにファイル・行参照を貼り付けます。Enterは送信しません。参照にはコード本文や内容ハッシュを含めません。

左上のホームボタンからプロジェクト選択へ戻れます。未保存の編集は破棄前に確認し、ターミナルはプロジェクトごとに維持します。


## 開発構成

```text
src/
  main.ts                 # アプリの起動口
  app/                    # ワークスペース全体の組み立て・制御
  features/
    editor/               # コード表示・タブ・参照共有・テーマ
    explorer/             # ファイルツリー
    git/                  # 変更一覧・差分表示
    projects/             # プロジェクト選択
    settings/             # 設定画面
    terminal/             # ターミナルセッション・ドッキング
  components/             # 共通React UI（ui/ はshadcn/ui）
  lib/                    # 共通処理・Reactとの接続
  styles/
    globals.css           # Tailwindの読み込み
    tokens.css            # 色・文字サイズ・角丸・影の共通トークン
    base.css              # 要素のリセットとライブラリ統合
    renderer-theme.ts     # Monaco・xtermへのトークン受け渡し
  assets/                 # 配布元ライセンスを保持するアイコン素材
```

Reactコンポーネントのスタイルは `className` のTailwindクラスで指定します。
色・文字サイズ・角丸・影は `src/styles/tokens.css` に集約し、コンポーネントから意味のあるTailwindクラスで参照します。Monaco・xtermも同じトークンを読み取ります。構文配色と配布アイコンは配布元のテーマを保持します。動的な幅・位置・インデントはレイアウト値として指定します。DOM操作のためのクラスはスタイル定義には使いません。`pnpm run check:design` でトークン外の色や文字サイズなどを検査します。

`biome.json` がこのプロジェクトの整形・静的チェック設定です。

- `pnpm run format`: コードを整形
- `pnpm run lint`: 静的チェック
- `pnpm run check`: 整形・静的チェック・import順を検証
- `pnpm run check:fix`: 安全な自動修正
- `pnpm run typecheck` / `pnpm test` / `pnpm run build`: 型・振る舞い・ビルドの検証

配布元のアイコン素材、ビルド出力、検証用プロジェクトはBiomeの対象に含めません。

## チャットからファイルを開く

「このファイルをPlasmaで開いて」と会話で依頼すると、Codexが `open_workbench` を呼び出して会話パネルに対象を開きます。`route` 引数でプロジェクト・ファイル・行範囲を指定します（`/open?project=...&file=...&line=22&endLine=26`、各値はURLエンコード）。指定しない場合はプロジェクト選択画面になります。

会話パネルでファイルと22〜26行の選択を実画面で確認済みです。通常のチャット内ファイルリンクのクリック先は変更しません。サイドバー用リンクやチャットのボタン記法を代替として使うことはせず、会話からの依頼に統一します。

## フォントサイズ

設定 → 外観でUI・コードエディタ（差分を含む）・ターミナルをそれぞれ10〜32pxに変更できます。変更は即時反映され、すべてのプロジェクト共通で `~/.config/typescript-workbench/appearance.json` に保存します。「Reset to Defaults」は上書きを削除し、デザイントークンの初期値を使用します。すでに開いている別のPlasma画面への反映は、その画面を開き直したときになります。
