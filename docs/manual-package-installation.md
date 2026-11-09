# 手動パッケージ導入

Marketplaceの「パッケージのソース」にURLまたはnpmパッケージ名を入力し、**インストール → 確定**で取得します。固定カタログへの掲載は不要で、個人・非公開リポジトリも同じ経路です。

対応例（実在パッケージの推薦ではありません）:

```text
https://github.com/your-name/your-repo
https://github.com/your-name/your-repo.git#main
git@github.com:your-name/private-repo.git#v1.0.0
ssh://git@github.com/your-name/private-repo.git
https://www.npmjs.com/package/@your-name/your-package
https://npmjs.com/package/@your-name/your-package/v/1.2.3/
@your-name/your-package@next
npm:@your-name/your-package@^1.2.0
```

GitHubはリポジトリ直下のURLを指定してください。ブラウザの`/tree/main` URL、認証情報やクエリ付きURL、ローカルパスは受け付けません。Gitのブランチ・タグ・コミットは`#ref`で指定します。

## 個人・非公開ソース

- GitHub HTTPS: 設定済みのGit credential helperを使用します。
- GitHub SSH: 設定済みのSSH鍵・agent・known_hostsを使用します。
- npm: 利用者の既存`.npmrc`やnpm認証設定を使用します。private scoped packageも指定できます。
- 新しい認証画面は開きません。先に対象ツールの非対話認証を設定してください。URLにPAT・パスワード・tokenを埋め込まないでください。
- RTKとGit/npmが必要です。RTKなしの直接実行への切替はありません。

## 取得と有効化は別

- npmは解決した正確なバージョン、Gitは取得したコミットを固定します。
- stagingで検証してから公開し、取得失敗時は現在の導入状態を保持します。
- install/prepare/postinstallスクリプト、Git checkoutのhooks、旧`pi.extensions`は実行・解釈しません。ビルドが必要なリポジトリは、利用できるエントリを公開側で用意してください。
- **インストールだけではimport・選択・有効化しません。** 対応するnative拡張をTypeScript設定に明示し、安全に適用できることを確認してから使用します。旧SDK拡張との互換性は推測しません。
- 共有するDurable/pi-ai/Chordはホストの1.5.0、`@pig/config`は同梱API v2を使います。重複コピーや非互換peerは拒否します。
- 更新・再導入・削除・rollbackはHostの安全確認が必要です。実行中・待機中のTaskや互換性を確認できない依存がある場合は拒否・保留し、チャットの自動再読込はしません。

導入元の検証はsandboxではありません。後から明示的にロードした拡張は信頼済みコードとして動作するため、信頼できるソースだけを使用してください。

実際のprivateリポジトリへの接続・認証は、利用者の環境での確認が必要です。自動テストは一時ディレクトリと模擬コマンドを使用し、個人の認証情報を読みません。
