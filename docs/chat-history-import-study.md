# デスクトップアプリのチャット履歴の取り込み

設定 → **チャットのインポート**。この端末のデスクトップアプリが自分で保存している
履歴ファイルを直接読む。ログイン・Cookie・ネットワーク通信は使わない。

## 画面

数百件（確認した端末でCodex 248件）を前提にした一覧。

- 上：取り込み元のタブ（Codex・Claude Code・エクスポートファイル）。プロバイダー設定の
  Agent / Image / Classification と同じ `segmented-control`。ページを開いた時点でCodexを読み込む。
  エクスポートは「ファイルを選択…」を押したときだけファイルダイアログを開く。
- 一覧の上：タイトル検索・プロジェクト絞り込み（フォルダー名と件数、多い順）・並び順（新しい順・古い順・タイトル順）。
- 一覧：「表示中をすべて選択」は絞り込み結果だけが対象。選択は絞り込みを変えても保持。
  行はタイトル・プロジェクト・更新日時で高さを揃え、一覧だけを縦スクロールする。
- 下：取り込み先。登録済みプロジェクトで絞り込むと、そのプロジェクトが取り込み先になる。
  取り込み後も一覧はそのまま（別プロジェクトを続けて取り込める）。結果は通知で出す。

## 取り込み元と保存場所

| 取り込み元 | 一覧 | 本文 | 根拠 |
| --- | --- | --- | --- |
| Codexアプリ（Windowsでは`ChatGPT.exe` / `OpenAI.Codex`パッケージ）・Codex CLI | `~/.codex/state_5.sqlite` の `threads`（タイトル・cwd・更新日時・`rollout_path`） | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`、アーカイブは`archived_sessions/*.jsonl.zst` | [openai/codex](https://github.com/openai/codex/tree/b016cd18472588606c04af565528c4cd6746a41f) `codex-rs/rollout/src/list.rs`・`recorder.rs`、`codex-rs/state/migrations/0001_threads.sql` |
| Claude Code（CLI・Claudeデスクトップのコード） | `~/.claude/projects/<プロジェクト>/*.jsonl` の先頭（最初の発言・`cwd`） | 同ファイル。`parentUuid`で分岐、`isSidechain`はサブエージェント | 実ファイルの構造で確認 |
| 公式エクスポート（ChatGPT / claude.ai） | `conversations.json` | 同ファイル | 各社のヘルプ |

確認した端末では、ログインなしで Codex 248件・Claude Code 98件を一覧でき、各3件を取り込んで
再openできた。一覧はCodex 52ms・Claude Code 335ms。

### Codex

- `threads.source` が `{"subagent"…}` の行は内部のサブエージェントなので一覧に出さない。
  `rollout_path` が存在しない行（削除済み）も出さない。
- 本文は `type: "response_item"` かつ `payload.type: "message"` の `user` / `assistant`。
  `developer`・`system` と、`<environment_context>` や `# AGENTS.md instructions` 等の
  ハーネスが差し込んだユーザー入力は除外する。
- `reasoning`・`function_call`等は本文にせず、省略情報として記録する。
  ツールを挟んで続くassistantの出力は1つの返答にまとめる。
- モデル名は `thread_settings_applied` / `turn_context` から取る。
- 実行中のセッションの末尾の途中行は読み飛ばす。SQLiteは読み取り専用で開き、すぐに閉じる。
- Windowsの `cwd` に付く `\\?\` は一覧取得時に除去し、`\\?\UNC\server\share`
  は通常の `\\server\share` に戻す。SDKのセッションディレクトリー名に `?` を混入させない。

### Claude Code

- 最後の非サイドチェーンの発言から `parentUuid` をたどった、選択中の分岐だけを取り込む。
- `isMeta`、`<command-name>`等のコマンド出力、`tool_result`だけのユーザー行は除外する。
- `thinking`・`tool_use`は本文にせず省略情報として記録する。

## 端末に残っていない履歴

ChatGPT・claude.ai の通常のチャット（Webと同じ会話）は各社のサーバーにあり、
デスクトップアプリのフォルダにはキャッシュの断片しかない。

- ChatGPT Windows: `…\LocalCache\Roaming\ChatGPT\IndexedDB\https_chatgpt.com_0.indexeddb.leveldb`
- ChatGPT macOS: `~/Library/Application Support/com.openai.chat/conversations-v3-*`（暗号化）
- Claude Desktop: `%LOCALAPPDATA%\Claude-Data\anthropicpbc.claude_*\`（Store版）。
  IndexedDBは58KBで、全履歴は入っていない

既存のブラウザー拡張（pionxzh/chatgpt-exporter、Claude Exporter系）も、ファイルではなく
ログイン済みのページ内からサービスのAPIを呼んでいる。これらの会話は公式エクスポートで取り込む。

## 取り込みの扱い

- 1会話を1つのPiセッションとして保存する。元の日時・タイトル・元モデル名を保持し、
  続きはこのアプリで選んだモデルで話す。
- 内容と取り込み先からIDを決め、同じ内容の再取り込みはスキップする。
  会話が伸びた後に取り込み直すと別のスナップショットになる。既存ファイルは上書きしない。
- 添付・ツール実行・思考は取り込まない（各行に省略として表示）。
- 一覧取得時は本文を読まず、取り込む会話だけを読む。大きなrolloutは行単位で読む。
- 失敗は会話ID・会話名・例外メッセージを返し、通知にも具体的な理由を表示する。
  Bun側のログにも `[chat-history-import]` と原因を残す（本文は記録しない）。

### Windowsで全件失敗していた原因と再現確認

Codexの `\\?\C:\…` をそのままSDKの保存先名へ変換すると、`---?-C--…--` となり、
`mkdir` が `ENOENT` で失敗していた。例外を握りつぶして失敗件数だけ返していたため、
画面では理由が分からなかった。従来の試験は保存先を一時ディレクトリーに固定しており、
実際のプロジェクトパスから生成されるディレクトリー名を検査していなかった。

実データを読み取り専用で扱い、SDKと同じディレクトリー名を一時フォルダー内に生成して確認：

- 修正前：Codex 241件で保存先作成に失敗。
- 修正後：本文のあるCodex 241件・Claude Code 98件の保存に成功。
- 残るCodex 7件はメタデータと設定変更だけで、ユーザー・アシスタントの本文がない。
  これは保存先エラーとは区別し、本文がない旨を失敗理由に出す。

ドライブ・UNC両方の名前空間パスからの保存と、ローカル／エクスポートの原因付き失敗応答、
通知履歴の実描画を回帰テストに追加した。元履歴・通常のセッション保存先は変更していない。

## 実装

| 箇所 | 役割 |
| --- | --- |
| `apps/desktop/src/bun/local-chat-history.ts` | Codex / Claude Code の一覧と本文の読み取り |
| `apps/desktop/src/bun/chat-history-import.ts` | Piセッションへの変換・非上書き保存、エクスポートファイルの取り込み |
| `apps/desktop/src/bun/chat-history-parser.ts` | ChatGPT / Claude 公式エクスポートの解析 |
| `apps/desktop/src/mainview/ChatHistoryImportSettings.tsx` | 設定の「チャットのインポート」 |
| `apps/desktop/src/stories/settings/ChatHistoryImport.stories.tsx` | Storybook（Settings/Chat History Import） |

テスト：`local-chat-history.test.ts`（Codex / Claude Code のfixture）、
`chat-history-import.test.ts`・`chat-history-parser.test.ts`、
`chat-history-import-ui.test.ts`（Edgeでの描画と操作）。
