# セッション情報UI：実画面・実装の比較調査

## 調査の目的と範囲

pigの既存サイドバー・会話・入力欄・ModelPicker・配色は変更対象ではない。追加するセッション情報UIだけを設計するため、他ハーネスの**実画面、表示条件、情報密度、詳細表示への遷移、実装**を比較した。

今回は調査文書のみを追加。製品コードの変更、画像生成、新しい画面モックの制作は行っていない。

### 根拠の種類

- **目視**：公開画像または公開動画の特定フレームをブラウザで表示・キャプチャして確認したもの。製品を実際に操作したこととは区別する。
- **実装**：固定commitの公開ソースを読み、条件・寸法・状態遷移を確認したもの。
- **仕様**：公式ドキュメント。動画・画像にない挙動について、目視確認済みとはしない。
- **提案**：上記からpigに適用する判断。他製品そのものの仕様ではない。

## 1. OpenCode：常設の大きな監視画面ではなく、短い要約から展開

### 実装根拠

対象commit: `12a661ea40cd5863b271a89bb06b8a3ddb7ab5a0`。

- [composer/region.tsx](https://github.com/anomalyco/opencode/blob/12a661ea40cd5863b271a89bb06b8a3ddb7ab5a0/packages/app/src/session/composer/region.tsx)
  - 468行付近：TODOを履歴とrevert境界から投影。
  - 表示条件は、TODO有効・セッション作業中・リストあり・未完了あり。全完了の一覧を常時表示する設計ではない。
  - 585行付近：TODOと活動要約は同じComposerLaneに配置。
- [composer-lane.tsx](https://github.com/anomalyco/opencode/blob/12a661ea40cd5863b271a89bb06b8a3ddb7ab5a0/packages/app/src/session/composer/composer-lane.tsx)
  - 入力欄の上に横並びのレーン。詳細は上方向に開く。
  - コメントで、タイムライン末尾の余白を予約し、表示の出入りでcomposerや会話が移動しないことを意図している。
- [composer-lane.css](https://github.com/anomalyco/opencode/blob/12a661ea40cd5863b271a89bb06b8a3ddb7ab5a0/packages/app/src/session/composer/composer-lane.css)
  - capsule高さ32px、左右padding 10px、gap 8px、角丸8px。
  - 文字13px、weight 440、letter-spacing -0.04px。背景・浮き上がり・focusはsemantic token。
  - 開閉150ms、reduced-motionに対応。

### TODO

[todo-pill.tsx](https://github.com/anomalyco/opencode/blob/12a661ea40cd5863b271a89bb06b8a3ddb7ab5a0/packages/app/src/session/composer/todo-pill.tsx) / [CSS](https://github.com/anomalyco/opencode/blob/12a661ea40cd5863b271a89bb06b8a3ddb7ab5a0/packages/app/src/session/composer/todo-pill.css)

- 通常は現在の項目と状態glyph。常時すべての項目を並べない。
- ラベル最大幅260px。計画全体はクリックでpopoverへ。
- 展開一覧は最大高232px。進行中の項目が見える位置へスクロール。
- popoverは最低240px、最大400pxまたはviewportから56pxを引いた幅。
- 完了・未着手・キャンセルは文字の強弱に加え、形でも区別。

### Subagent / background

[activity-chips.tsx](https://github.com/anomalyco/opencode/blob/12a661ea40cd5863b271a89bb06b8a3ddb7ab5a0/packages/app/src/session/composer/activity-chips.tsx) / [CSS](https://github.com/anomalyco/opencode/blob/12a661ea40cd5863b271a89bb06b8a3ddb7ab5a0/packages/app/src/session/composer/activity-chips.css)

- 一件ずつカードを常設せず、稼働中の作業を一つのcapsuleに要約。
- 展開一覧はicon / agent / 内容 / 時間の4列grid。列間8px。最低240px、最大360px、最大高270px。
- 経過時間と停止操作は同じセルを使い、hover時の表示変更で列幅が動かない。
- touchでは停止操作を常時出し、44pxの操作領域を用意する。
- shell選択時は**同じpopoverの内容を詳細へ切り替える**。最大幅560px・高320px。別のカードを積まない。
- subagentはchild sessionへ移動。子のcomposer位置には32pxの静かな状態・モデル・時間・親へ戻るバー。
- 詳細から戻る際のフォーカス位置まで実装されている。

### 目視した資料

- [Desktop紹介ページ](https://opencode.ai/desktop)
- [公式映像](https://opencode.ai/files/site/2026-11/product-videos/heroes/desktop-landscape-dark.mp4) の6.5秒。
- この場面ではdiffと会話の分離、短いツール使用要約、抑えたcomposerを確認。**上記TODO/activity popoverそのものの表示はこの動画では確認していない**。
- 実装には [Todo pill Storybook](https://github.com/anomalyco/opencode/blob/12a661ea40cd5863b271a89bb06b8a3ddb7ab5a0/packages/app/src/session/composer/todo-pill.stories.tsx) と [Activity chips Storybook](https://github.com/anomalyco/opencode/blob/12a661ea40cd5863b271a89bb06b8a3ddb7ab5a0/packages/app/src/session/composer/activity-chips.stories.tsx) があり、後者は12 agents＋2 shellsやlive状態も扱う。今回はStorybookを起動していない。

**pigへの示唆（提案）**：情報が増えても、常設部分を同じ面積のカードで増やさない。現在の作業の要約から一覧・一件の詳細へ進む。位置・文字・フォーカスが更新のたびに動かないこともデザインの一部。

## 2. Cline：コンパクトなカードはあるが、主にツール実行の履歴

### 実装根拠

対象commit: `5413dc180c10700ce2e26547ab75991360dd0486`。調査した実装は**VS Code webview**であり、Desktopの映像と同一実装だとはみなさない。

- [ChatView.tsx](https://github.com/cline/cline/blob/5413dc180c10700ce2e26547ab75991360dd0486/apps/vscode/webview-ui/src/components/chat/ChatView.tsx)
  - TaskSection→MessagesArea、固定footerにAutoApproveBar・ActionButtons・QueuedPrompts・InputSection。
- [SubagentStatusRow.tsx](https://github.com/cline/cline/blob/5413dc180c10700ce2e26547ab75991360dd0486/apps/vscode/webview-ui/src/components/chat/SubagentStatusRow.tsx)
  - 会話内のstatus/tool messageから描画する。セッション全体の専用ダッシュボードではない。
  - 小さいbordered itemで、状態・担当prompt・tools/tokens/cost・最新toolを表示。
  - promptは2行まで。溢れたときだけ展開操作。promptの展開とoutputの展開は独立。
  - outputは既定で閉じ、結果/エラーがある場合に開ける。
- [CommandOutputRow.tsx](https://github.com/cline/cline/blob/5413dc180c10700ce2e26547ab75991360dd0486/apps/vscode/webview-ui/src/components/chat/CommandOutputRow.tsx)
  - 5行以下は全表示。長い出力は75pxの末尾preview、展開時200px。
  - 縮小中は末尾を追従し、展開したら閲覧中の位置を保護。
  - cancelはbackground実行モード＋操作capabilityがある場合だけ。通常terminalではCtrl+C案内。
- [PlanCompletionOutputRow.tsx](https://github.com/cline/cline/blob/5413dc180c10700ce2e26547ab75991360dd0486/apps/vscode/webview-ui/src/components/chat/PlanCompletionOutputRow.tsx)
  - PlanモードのMarkdown応答。TODO進捗ではない。未完成の問いかけである可能性もある。

### 寸法と色

- agent itemは `rounded-xs border ... px-2 py-1.5`。
- statsは11px、最新toolは10px・一行省略。この小ささは実装上の事実であり、pigへそのままコピーする推奨ではない。
- 背景・枠・success/errorはVS Code theme tokenを利用。独自の別パレットを持ち込まない。

### 目視した資料

- [Cline Desktop](https://cline.bot/desktop)、[公式映像](https://cline.bot/assets/videos/optimized/cline-code-mac-app.webm)。1、5、13、16秒を確認。
- 13秒ではsidebar・会話・composerを残した作業中画面、16秒では会話内のdiffとThinking表示を確認。
- 1、5秒はcomposer/モデル選択の拡大。これだけから全体配置を判断しない。
- Desktopページには、follow-up queueをcomposerの上で編集・並べ替え・即送信・削除する説明がある。これは**入力待ちメッセージ**でありTODOではない。

**未確認**：今回読んだChatView等にTODO/checklist rendererは見つからなかった。機能全体が存在しないという意味ではない。古いFocus Chainの記憶を現在の実装へ混ぜない。

**pigへの示唆（提案）**：ツール実行の履歴とセッション全体の現在状態を混ぜない。ログは最新出力を短く見せ、詳細に入った後は勝手に末尾へ戻さない。

## 3. Claude Code：必要になった入口から、目的別の詳細へ

### 公式仕様

- [Desktop — Arrange your workspace](https://code.claude.com/docs/en/desktop#arrange-your-workspace)
  - chat / diff / plan / tasks / subagentのペインを開閉・配置・サイズ変更する。
  - PlanやBackground tasksのメニュー項目は内容がある場合に現れる。
- [Desktop — Watch background tasks](https://code.claude.com/docs/en/desktop#watch-background-tasks)
  - セッションのメニューから開く。subagent・background shellを選んでoutputや停止操作へ。
- [VS Code — Use the prompt box](https://code.claude.com/docs/en/vs-code#use-the-prompt-box)
  - 入力欄下部のAgent件数からツリーマップを開く。
  - ノードを選ぶとprompt・tool call・read-only transcript・停止操作。その他のbackground tasksはAgent群の下。
  - `/tasks`は件数indicatorがなくても入口になる。
- 同VS Code文書：Focus viewではtool/thinkingを折り畳むが最新TODOは残す。**TODOの固定位置が入力欄上だとは文書だけでは断定しない**。
- PlanはMarkdown文書を開いてinline feedbackを行う。ツールの編集承認はdiffと許可操作であり、進捗表示とは別。
- [Desktop — Session details](https://code.claude.com/docs/en/desktop#see-session-details)
  - chat横のrailは幅が足りる場合に表示し、show/hide可能。diffやreview findingsへ進む。

### 目視した資料

[公式VS Code画面](https://mintcdn.com/claude-code/-YhHHmtSxwr7W8gy/images/vs-code-extension-interface.jpg) を確認。editorとconversationを並べ、会話中ではRead/Writeを状態点と短い行で示す。本文の中に必要なdiffがあり、composerは下部に残る。

**未確認**：この画像にツリーマップは写っていない。マップの存在・入口は公式仕様の根拠。Desktopの現行ペイン配置とVS Codeの画像を同一画面として扱わない。非公開frontendのcomponent名やCSS値は推測しない。

**pigへの示唆（提案）**：DAGは全Agentの詳細カードを小さく並べたものにしない。全体の関係を軽く見せ、選択した一件の担当・活動・ログを別に示す。何もない機能の入口・空カードを常設しない。

## 4. Codex：会話の読みやすさを守る要約、目的別の補助表示

### 目視した資料

- [OpenAI公式 Introducing the Codex app](https://www.youtube.com/watch?v=HFM3se4lNiw)。50、65、85、230秒を確認。
- 50〜85秒では、Exploring/ExploredやCreated/Editedを短い行とdisclosureで示す。作業ごとに大きな外枠を付けず、file名・変更数・状態を同じ行に置く。
- 230秒ではcomposerとLocal/Worktree/Cloudの実行場所表示を確認。これをpigへ追加する提案ではない。
- 映像は2026年2月の紹介。現行仕様・最新バージョンの全レイアウトを保証しない。

### 公式仕様

- [Long-running work](https://developers.openai.com/codex/long-running-work#steer-a-running-goal)：入力欄上のcompactなgoal進捗行、pause/resume/edit/clear。follow-upも送れる。
- [Subagents](https://developers.openai.com/codex/agent-configuration/subagents)：Desktopでは子threadと返されたsummaryを確認できる。
  - 同ページの「composer上で展開／stop all」はIDE説明と区別する。Desktopの同位置をこの記述で証明しない。
- [Review](https://developers.openai.com/codex/app/review)：repo状態のdiff、Staged/Unstaged/Commit/Branch/Last turnのscope、file単位の展開、inline comment。
- [Automations](https://developers.openai.com/codex/automations)：scheduled workと実行結果のinboxは通常の会話と別surface。

**資料上の注意**：現在の一部 `/codex/app/` ページはChatGPT desktop appという名称で複数surfaceの説明を含む。公開動画・Desktop・IDE・CLIを混同しない。紹介記事の取得は403で、根拠には使っていない。

### 動画IDの照合

公式indexのHTML埋め込みデータとYouTubeの実タイトルを照合した。抽出段階の対応誤りを修正し、以下を採用する。

- `HFM3se4lNiw`: Introducing the Codex app（目視済み）
- `9ohXlkbXiM4`: Multitasking with the Codex app（index照合のみ）
- `xHnlzAPD9QI`: Automate tasks with the Codex app（index照合のみ）
- `P7HXxl14dCA`: How designers prototype using the Codex app
- `1XkVsE9-ZK4`: Codex in JetBrains IDEs。Desktop紹介としては使用しない。

**pigへの示唆（提案）**：常設summary、作業履歴、review、scheduled inboxの役割を分ける。「セッションモデルに存在するもの」をすべて一つのpaneに出す必要はない。

## 5. ユーザー指定のHerdr + OMP + Magpie

[指定動画](https://x.com/lexrus/status/2119443089760960679/video/1) は別途0.5、8、16、24秒を目視済み。

- 右上に小さいnode-link図、下は行主体のrequest履歴。大きなカードを種類ごとに三段重ねした画面ではない。
- 同じ右領域の内容を目的に応じて切り替える。右ペインの存在そのものが問題なのではない。
- 動画上の図はprovider/routing表現。**subagent DAGの実装例と断定しない**。pigでは関係の見せ方だけを参考にする。
- OMPの[Agent Hub仕様](https://github.com/can1357/oh-my-pi/blob/21f1188cf88b2f534c092181968cd5a4d1a9c296/docs/agent-hub.md)では、composer上の短いpinned一覧と、詳細なHubを分ける。すべてを常時展開しない。

## 6. 前のpig案の問題

1. **ドメインモデルをそのままUIへ露出**：Source、ID、revision、No action supplied等はユーザーの判断ではなく接続の診断情報。
2. **要約・一覧・詳細を同時に常設**：進捗もAgentもログも同じ大きさのカードにし、重要度を区別できていなかった。
3. **擬似的な段階を固定**：「確認→分析→整理→検証→報告」はデモの都合。実TODOの工程・件数・並行状態から描画する必要がある。
4. **グラフを小型カードの固定配置にした**：関係・状態より箱が目立つ。実際のparent/dependencyがなければ線を捏造してはいけない。
5. **既存画面まで再描画した**：独自HTMLで会話・sidebar・composerを再現すると、実フォント・余白・幅・透過・スクロールとの関係を失う。合成画像の見た目を本体の完成度とみなせない。
6. **背景面を増やした**：session headerだけ別色のbandを作り、既存画面との連続性を壊した。

## 7. pigで採る設計原則（未実装の提案）

### TODO：達成済み／現在／残りを一目で

- 実データの件数・工程に応じた薄いprogress表現＋現在の作業名。
- フェーズがないExtensionへ固定の5段階を押し付けない。並行作業なら一つの現在項目に偽装しない。
- 詳細一覧は開いたときだけ。完了・中止・blockedを同じdoneへ潰さない。
- OpenCodeのsummary→full planと、ユーザー指定の進捗の分かりやすさを組み合わせる。

### Subagent：関係の図と、一件の詳細

- Mainからの委任・依存を小さな状態点、短い名称、細い接続で示す。ノード内に長い説明、model、usageを全部入れない。
- 選択した一件だけ担当・現在の処理・実行時間・ログ・利用可能な操作を表示。
- 親子線と依存線を意味として区別。全員を架空のReviewへ合流させない。
- 1件・並列数件・多件数で密度を検証する。12件を同じ巨大カードの繰り返しにしない。

### Background：進捗ではなく稼働状況

- command/用途、状態、経過時間、直近の出力を横方向に揃えたjob行。
- 実測のtotalがない限り、完了率や進捗barを作らない。serverの稼働は工程完了と別。
- ログは短いtail→選択した一件の詳細。閲覧中のスクロール位置を保護。
- 停止操作の出入りで行・列がずれない。停止要求中と実際の終了を区別。

### 共通

- 平常時のsummaryは小さく、詳細は選択に応じて一つずつ。空の機能や0件のsectionを並べない。
- タイトル・状態・補助情報の文字の強弱と行揃えを先に設計し、背景cardを増やして区切らない。
- 値の変化でレイアウトが跳ねない。経過時間は固定幅、補助文は省略と詳細表示を使い分ける。
- 閉じる・戻る・停止後のfocus、keyboard、touch、reduced-motionも対象。見た目だけのmockを完成扱いにしない。
- 他製品の13pxや8pxを無条件にコピーせず、pigの既存token・配色・可読性へ合わせる。既存本文や入力欄は変更しない。

## 次のプレビューの条件

これは実装着手の承認ではなく、以後の提案を検証する条件。

1. pig本体の既存componentとthemeを使う。sidebar・会話・入力欄を描き直さない。
2. 表示用fixtureは追加領域だけに与える。実状態とデモを区別する。
3. 空／通常稼働／待機・失敗／全完了／多数Agentの状態を同じ画面で比較する。
4. 実際の利用幅で本文と入力欄を残したまま確認する。別UI単体の拡大や画像生成だけで採用を決めない。
5. 本体の未承認レイアウト変更は行わず、まず追加UIの表示と開閉をユーザーが確認できる状態にする。

## 未実施・限界

- 他製品のインストール・ログイン・agent実行・ローカルStorybook起動はしていない。
- 公開動画の目視と、固定ソース/公式仕様の確認を行った。全操作を実機で再現したわけではない。
- OpenCodeのTODO/activity popover、Claudeのagent mapは主に実装/仕様を根拠としており、今回目視した画像に写っているとはしていない。
- Codex/Claudeの非公開frontendのCSS・component internalsは調査できない。公式動画と公開仕様以上の断定は避ける。
- 既存のpig画面・製品コードはこの調査で変更していない。
