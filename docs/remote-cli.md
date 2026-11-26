# Remote Pairing（Windows Tauri版）

自宅と研究室で自分専用のWindowsログインを使う場合向け。登録端末はホストの登録済みプロジェクト・
一般チャットの履歴を読み、ホストのモデル・ツールに指示できる。他人への共有には使わない。
設定しなければ秘密鍵は作らず、リモート用プロセスも起動しない。

## アプリで登録する

1. ホストのサイドバー下部でリンク形の **Pairing** を開き、「他のPCからの接続を許可」をオンにする。
2. 「PCを追加…」で1回限りのコードをコピーし、自分の別のPCに安全に渡す。使用前なら「コードを取り消す」で無効にできる。
3. 相手のPCで **Pairing → PCに接続…** にコードを貼り付けて「接続」を押す。ホスト側に登録完了が表示されたら、クリップボードからコードを消す。

相手の接続権限はホストの一覧で「削除」を二度押しして取り消す。接続先をクライアント側で削除しただけでは、ホストの登録は消えない。
画面で選んだ待ち受けのオン・オフは次回も有効。明示的なオフは `PIG_REMOTE_ENABLED=1` より優先する。
再起動後も未使用の招待は期限まで有効。コード自体は再表示しないが「PCを追加…」から取消・置換ができる。
初回登録の応答が途切れたら、研究室側で同じコードを再度使ってよい。ホストにすでに登録された同じ端末鍵なら、
新しい招待を発行せずに接続先を復元できる。未登録・失効済みの端末に権限を付け直すことはない。

接続後の「Projectを選ぶ…」または一覧の「Project…」で、サイドバーに出すProject・Projectなしのチャットを選んで保存する。
「フォルダーを選択」ではホスト側で登録済みのProject配下をたどり、子フォルダーをProjectとして追加できる。別の場所は先にホストで登録する。
サイドバーの接続先PCの下でProjectを展開し、既存チャットを選ぶか鉛筆ボタンで新規作成する。送信先のPC名とProject名は入力欄の上に表示される。
受付が不明なときは再送せず「受付を確認」を使う。ホストの承認が必要な操作にはホスト側で回答する。

## CLIで登録する場合：ホストで一度だけ

Tauriポータブル版の `pig.exe` と同じフォルダに `pig-remote.exe` が必要。
Scoop の Tauri Nightly では、両方ともインストール先の `current\bin` にあり、
起動ファイル名は `launcher.exe`。下の `.\pig.exe` は `.\launcher.exe` に読み替える。
開発時は `mise exec -- cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -p pig-remote`。
PowerShell 7でそのバイナリのあるフォルダから：

```powershell
$keys = Join-Path $env:APPDATA 'dev.pig.tauri\pig\pairing'
# PIG_DESKTOP_CONFIG_DIR を指定した場合はそのフォルダ下の pairing を使う。
.\pig-remote.exe init $keys
.\pig-remote.exe invite $keys | Set-Clipboard
$env:PIG_REMOTE_ENABLED = '1'
.\pig.exe
```

既に起動しているホストは一度終了してから有効化する。`init` は鍵を上書きしない。
コピーした招待をパスワードマネージャー等で自分へ渡し、クリップボードから消す。
研究室での登録時は自宅のpigが起動している必要があるが、自宅での再承認は不要。
使用前の招待を取り消すには `cancel $keys`、再発行は `invite $keys`（旧招待は即無効）。

## 研究室で

```powershell
$client = Join-Path $env:LOCALAPPDATA 'pig-remote-client'
.\pig-remote.exe init $client
Get-Clipboard | .\pig-remote.exe pair $client
Set-Clipboard -Value ''
function Invoke-Pig($q) {
  $reply = $q | ConvertTo-Json -Compress | .\pig-remote.exe call $client | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or !$reply.ok) { throw 'Remote operation failed' }
  $reply.value
}
$list = Invoke-Pig @{op='list'}          # offsetで次の100件。cwdやセッションファイルは送らない
$list.chats | Format-Table
$chat = Invoke-Pig @{op='open'; chat=$list.chats[0].chat} # 対象を選ぶ
$chat.messages
$v = $chat.view
$id = [guid]::NewGuid().ToString()
Invoke-Pig @{op='send'; view=$v; id=$id; text='前の作業の続きを説明して'}
Invoke-Pig @{op='receipt'; view=$v; id=$id}
Invoke-Pig @{op='read'; view=$v}         # 最新の応答・running・waitingForHostを再取得
```

回答が終わるまで追うには、送信を繰り返さず `read` だけを繰り返す。

```powershell
do {
  $state = Invoke-Pig @{op='read'; view=$v}
  $state.messages | Select-Object -Last 1
  if ($state.waitingForHost) { '自宅PCでの承認待ち'; break }
  if ($state.running) { Start-Sleep -Seconds 1 }
} while ($state.running)
```

`history` は `view` と、直前のページの `history.before` / `history.revision` を渡す。
これは読み取り時のスナップショットで、永続ストリームではない。出力上限による切り詰めは `truncated` で示す。
エラー・タイムアウトは「未送信」を意味しない。同じview・idでreceiptを照会し、再起動後に
viewが失効していれば、同じ会話を開き直し、新しい `view` と**元の送信ID**で `receipt` を照会する。
ホストの異常終了で最終結果が残っていない場合は不明のままにする。新しいIDで自動再送しない。
ターミナル、スラッシュコマンド、添付、ツールの生出力、承認回答は対象外。承認は自宅側で行う。

研究室PCの公開鍵は `.\pig-remote.exe id $client`。自宅PCで `.\pig-remote.exe revoke $keys <公開鍵>`
すると次の要求は拒否される。すでに受理されたモデル実行や、相手に配信済みの履歴は取り消されない。
ホスト終了で通信も停止。画面からの許可も `PIG_REMOTE_ENABLED=1` の指定もなければ、次回は待ち受けない。

## 検証

```powershell
mise exec -- cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -p pig-pairing
mise exec -- cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -p pig-remote
mise exec -- bun run apps/desktop/scripts/remote-smoke.ts
```

最後の検査は一時プロファイル、ループバック限定のiroh、実際のTauri用Bunホストとローカル模擬モデルを使う。
GUIは開かない。通常の接続ではirohの探索・直接接続・公開リレーを使い、別回線の到達性や中継の稼働は保証しない。
`--portable` は `tauri:smoke:package` で作った同梱バイナリを使用する。
`--public` を併用すると外部のiroh探索を使用する（リレー経由を強制する検査ではない）。

配布用ビルドは `tauri:package` の後に
`mise exec -- bun run apps/desktop/scripts/remote-smoke.ts --release` で検査する。
実際の Tauri アプリを一時プロファイルで開き、同梱 CLI と公開 iroh の探索で
登録・チャット送受信・解除まで確認する。別端末や別回線での到達性までは検査しない。
