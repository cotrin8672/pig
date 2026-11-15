# 会話の重さ：DOM削減後に測り直した結果

## 結論

前回の「保存済みコードの総DOMを16%減らす」変更だけでは不十分だった。
今回の200出力の比較でも、幅変更時の再配置はほぼ速くなっていない。
次に狙うべき対象は、**コードの色分けに必要な大量の要素**と、
**追記のたびにコード全文を解析する処理**。

ただし、これは実アプリの問題の会話を直したという報告ではない。
以下1〜5は独立Edge上の調査・試作時点の記録。
後続の**全文再解析を避ける本体実装は6節、DOM削減の本体実装と最終検証は7節**に記載した。
下記のDOM試作は画素一致をまだ満たしておらず、そのまま採用できない。

## 測定条件と再現

`apps/desktop/scripts/profile-conversation-rendering.ts`

```powershell
mise exec -- bun apps/desktop/scripts/profile-conversation-rendering.ts chat
mise exec -- bun apps/desktop/scripts/profile-conversation-rendering.ts stream
mise exec -- bun apps/desktop/scripts/profile-conversation-rendering.ts ranges
mise exec -- bun apps/desktop/scripts/profile-conversation-rendering.ts checkpoints
# 別プロセスでケース順を反転
mise exec -- bun apps/desktop/scripts/profile-conversation-rendering.ts ranges --reverse
```

- HEAD `987b16a`＋多数の並行作業。実行時点のproduction React/CSS/Workerを使用。
- 独立プロフィールのheadless Edge、1100×800、既存driverの`--disable-gpu`。
  実Windows WebViewのAcrylic・GPU合成を再現したものではない。
- ユーザーの会話・設定・認証情報にはアクセスしない。RPCはfixtureで置換する。
- 同じ80行のコードを20/200出力に配置する。解析結果は事前に温め、共有する。
  **DOM・再配置の分離用であり、実会話の多様なAST/画像/数式やメモリを再現していない。**
- 全文一致・native selection・最終更新反映などをassertする。
  入力遅延やp95を実ユーザーの操作に外挿しない。
- 計測はJSの同期区間、rAFの間隔、Long Tasks API。rAFの間隔はpaintの内訳でも、
  GPU時間でもない。タイマー間隔32msは目標であり、負荷時の実着信間隔保証ではない。
- 各ケースは独立ブラウザ。順序反転を含め複数回確認した。
  初期レイアウトにはfont/CSS立上がりのばらつきがあるので、下記は主に定常更新を比較する。

## 1. 前回のDOM削減では、重い再配置をほぼ減らせなかった

200個×80行のコード出力。12回の幅変更＋スクロール。
下記の時間は各実行の平均の範囲（独立した3回、うち1回は順序反転）。

| 方式 | Text nodeを含むDOM総数 | 幅変更＋同期layout |
| --- | ---: | ---: |
| 以前の行/token構造 | 400,000 | 116–131ms |
| 前回実装した保存済みcompact | 336,000 | 117–121ms |
| 色をRangeで全範囲に指定する試作 | 16,200 | 17–20ms |
| 色をRangeで表示範囲にだけ指定する試作 | 16,200 | 19–21ms |
| 無色テキストの対照実験 | 16,200 | 19–21ms |

**「16%減ったから軽くなった」とは言えない**ことを実際に確認した。
前回の方式ではtext nodeが200出力で207,800個残る。
色分け用の要素は減っても、文字を細かく分割してレイアウトする構造は残っていた。

### 95%減らしても失敗する例

CSS Custom Highlight APIを使い、1行1text nodeにしても、
全コードへ128,000個の色Rangeを登録すると、rAFの最大間隔は約250–683ms。
DOMは約95%少ないのに、幅変更・スクロールを組み合わせた負荷は重いままだった。
layout以外のRange描画等のコストを正確に分類するtraceは取っていない。
**大量のDOMを大量のRangeに置き換えるだけでは採用しない。**

表示中の行だけ色Rangeを登録する試作では、最終位置で304 Range、
同じ複合負荷のrAF最大間隔は50msだった。
本文のDOMは画面外も含めて全行残し、文字や履歴の切詰め・unmountはしていない。
スクロールに合わせて色指定だけを差し替えている。

### スクロールだけなら話が違う

幅変更を除いた24回のprogrammatic scrollも別に測った。
既存構造・前回compact・表示範囲Range試作はいずれもp95約16.7–16.8ms。
全範囲Rangeには最大約333msの間隔が出た。
したがって、**既存の純粋なスクロールが常に120msかかるという結果ではない。**
実ホイール・タッチのcompositor scroll、入力、IME、選択しながらのスクロールは未測定。

### 試作をそのまま本体に入れない理由

- 通常の色付きコードで、native全選択の文字列は完全一致した。
  ただし先頭行のスクリーンショットhashは既存構造と一致しなかった。
  文字ごとのRange矩形では最大**0.09375px**の位置/幅差があった。
  同じ色・見た目を保証したとは扱わない。無色対照とも画素は異なり、単に色が落ちている
  実験ではないが、色値・AA・字形配置それぞれの一致の証明でもない。
- Custom Highlightは`font-weight`/`font-style`を適用できない。
  試作はその装飾や背景を持つtokenをassertで拒否する。太字/斜体等は既存spanを残す
  hybridか、従来方式へのfallbackが必要。ANSIや差分背景まで対応した実装ではない。
- prototypeは測定ループ内でscrollTop変更直後に色を更新するだけ。
  実際のscroll/resizeイベント、内側スクロール、急な検索jump、配信中の更新、
  compositorが先に動く際の色抜けはまだ解決していない。
- 選択方向・注釈Range・注釈の色優先度・theme変更・拡張Renderer・コピー形式・アクセシビリティは
  本番統合で検査が必要。native選択文字列の一致だけでは互換性の合格にしない。
- Reactが既存text nodeの全文を書き換えると選択Rangeを失う問題は別に残る。
  配信開始時から使える構造を設計し、追記では既存文字を置換しないことを証明する。
  完了時に全DOMを差し替えて取り繕わない。

## 2. 長いコードは「少し追記するたびに全文解析」が残る

本番`CodeText`と`Markdown`に、32ms待ちで32回、計470文字を追記した。
コード初期値は1,500行・45,779文字。

| 経路 | 色分けWorkerへ送ったjob | UIに採用されたjob | 色分けの往復平均 |
| --- | ---: | ---: | ---: |
| CodeText直接（ツール出力等の経路） | 10–11 | 1 | 129–142ms |
| Markdown内のコード | 10–11 | 1–8 | 131–132ms |

採用数は更新タイミングに左右される。queueの`cancelled=31`を
「31回全文を計算した」とは解釈しない。未開始で捨てられたjobも含むため。
ただしCodeTextでは実行済み10–11件のうち1件しか利用されず、
既に実行中だった古い解析が最後まで走る状況を再現できた。

- 470文字の追加に対して、実際にsyntax Workerへ渡した文字数は約46–51万文字。
  圧縮/IPCの話ではなく、ブラウザ内の全文再解析入力の合計。
- Markdown自身にも全文解析があり、往復平均約23–26ms。
- `Markdown`には**既に100msのtext samplerがある**。
  snapshotが32ms間隔だからMarkdownを毎回32msごとに解析している、と説明してはいけない。
- 往復時間にはWorker計算、clone、配送、メインスレッドの受取待ちを含む。
  Workerの純CPU時間と同一ではない。
- 少ない80行では色分け往復は約7–9msで、同じ更新でも追いついた。
  軽い出力まで新しい複雑な仕組みが必要だという証拠ではない。

### 全文をやり直さない方法の実測

導入済みShiki 4.6.0には`getLastGrammarState(tokens)`と`grammarState`入力がある。
不変な1,500行の最後の解析状態を保持し、後続部分だけ解析した。
複数行コメント/HTML script境界/Python複数行文字列をまたぐ3言語で、
各16更新の**token本文・色・背景・fontStyle・補正後offset**が全文経路と一致した。

| 言語 | 全文解析平均 | checkpoint後の数行だけ |
| --- | ---: | ---: |
| TypeScript | 70–74ms | 約0.13–0.14ms |
| HTML | 15–16ms | 約0.13–0.15ms |
| Python | 約20ms | 約0.06–0.10ms |

2回、最初の2更新を時間集計から除外した。同一ブラウザ内で実行順を交互にし、結果比較は計測外。
**変更部分が数行の場合のtokenizerだけの差**であって、アプリ全体が数百倍になるという話ではない。
初回prefix解析・state生成、Worker転送、React、DOM、色描画はこの時間比較に含めない。

本番化はMarkdownを勝手に分割するのではなく、まずsyntax Worker内に限定する。
同じ言語・テーマ・設定で不変prefixが確認できる場合だけcheckpointを使う。
最終行への追記ではその行からやり直し、前方編集・短縮・言語変更・復旧は全文経路へ戻す。
キャッシュを際限なく増やさず、まずWorker内の直前入力1件の状態で十分か検証する。
キャンセル済みjobの結果をUIへ戻すのではなく、その解析状態を次の正しい入力の計算に使う。
全文結果oracle、全対応言語、CRLF/絵文字/途中行/長大行、複数出力の交互更新を検査する必要がある。
最初は現在のtoken応答形式を維持し、差分転送と同時に大改造しない。

## 3. 会話全体の再描画やscrollHeightはどうだったか

本番`Chat`に保存済みコード回答0/50/200件と短いlive回答を表示。
コードは各80行。履歴先頭を読む場合と末尾追従を比較した。

- 200件で138,026要素・総347,432 node。**128,000要素が構文色用span**。
  このコード中心のfixtureでは、周囲のボタンやラッパーより色分け要素が支配的。
- 32回の更新に対する同期commit（layout effectを含む）は、
  0件で平均約0.8–0.9ms、50件で約1.5–1.8ms、200件で約4.0–4.4ms。
- 末尾追従時の`scrollHeight` getterの最長は約1.4–1.5ms。
  先頭を読む場合は更新中の計測値はほぼ0。先頭位置を維持し、
  先頭の保存済みコード本文にはDOM mutationが起きなかった。
- 200件ではrAF最大約50–67msが出た。同期commit以外にも負荷はある。
  非同期Markdownのcommitやpaintは直接の`flushSync`時間に含まれない。

全履歴のJS組立てを分離する余地はあるが、このfixtureでは
**「scrollHeightを読むのを1回減らす」ことを主対策にする根拠は弱い。**
全履歴が毎更新書き換わっているという仮説も、この計測からは支持されない。

## 4. 実アプリについて確認できたこと／できないこと

アプリのprocess treeだけを読み取った3秒サンプル：

- WebView renderer：1コア換算CPU約26%、private約1,112MiB、working set約1,061MiB。
- Bun host：CPU約7%、private約3,482MiB、working set約1,087MiB。
- GPU process：CPU約18%。GPU使用率の測定ではない。

これは実行中の一時点であり、修正前後比較でもリーク判定でもない。
ブラウザDOMはBun host内のオブジェクトではないため、
**DOMを減らしてホストのprivate約3.5GiBまで解消する、とは言えない。**
private/working set/JS heapも別物。以前の2.6→4.5GBがどれなのかは未確定。

9229は不通で、実行中WebViewのcommand lineにもdebugging portはなかった。
アプリの再起動・設定変更・ヒープダンプ取得はしていない。
実際の問題の会話のrender/style/layout/paint/GC時間を確定するには、
別途許可を得て計測可能なビルドで再現する必要がある。

## 5. 次に実装するなら

1. **DOM側：色分けを大量の要素で表さない構造の互換性検証。**
   表示範囲の色指定を有力候補にし、字形・注釈・配信中の安定したtext nodeと実スクロールを解決する。
   文字本文は全行保持する。Range全量登録・完了時DOM置換・履歴仮想化は採用しない。
2. **配信側：syntax Workerの確定prefix再解析をなくす。**
   Shikiの既存状態APIを使用。出力内容や更新頻度を落とすのでなく、同じ計算をやり直さない。
3. **実アプリのCPU・メモリ原因を別々に確定する。**
   本番と異なるGPU無効fixtureの時間で「解消」を宣言しない。
   hostの大きなprivate領域はDOM対策と分け、数値samplingから調べる。

調査で追加したファイルはこの文書とprobeのみ。本体UI・配信仕様・SDK・依存は変更していない。
直接TypeScript、probeのBiome検査、4種の実ブラウザprobeのassertは通過。
既存のtoken/色分け/保持/Markdown処理の26テストと、DOM削減・描画再利用の
実ブラウザ2テストも通過。LSPは0件だったがpush-onlyで確認不完全のため、
cleanの根拠には直接TypeScriptを用いた。今回は本体変更なしのため全体unit/UI/Lintは再実行していない。
大きな性能閾値を通常UIテストへ追加したり、既存の許容値を広げたりはしていない。

参考：
[CSS Highlightの適用可能プロパティ](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::highlight)、
[Shiki Grammar State](https://shiki.style/guide/grammar-state)。

## 6. 実装指示後：syntax Workerの確定prefix再利用

最初の本体変更として、`syntax-engine.ts`に`createCodeTokenizer`を実装した。
通常のWorkerとSSR fallbackは既存の`tokenizeCode`名のまま使う。
UI・DOM・更新頻度・Worker要求/応答・キャンセル・並行数は変更していない。

- 完全な行だけを直前prefixとして1件保持し、Shikiの解析状態と正規化済みtokensを再利用する。
  同じ言語・解析設定かつ文字列prefixが完全一致する場合のみ有効。
- 最終行は毎回解析し直す。新たに完了した行は以前の状態から解析してprefixを進める。
  prefix内の編集・言語切替・別出力・無効な解析結果では不一致を再利用しない。
- 改行を含めて解析し、Shikiが末尾に返す空行だけを結合時に除く。
  CRLFを分断してCRを別改行として誤解釈することを防ぎ、元のCR token/offset規約も保持する。
- ANSIは従来の全文経路を維持。表示キャッシュの容量・保持方針は変更していない。
  過去のprefix一覧や全メッセージの新しいstate cacheは作っていない。
- 従来の全文アルゴリズムを独立oracleにし、通常24言語とANSIの文字・色・背景・fontStyle・offsetを比較する。
  追記・編集・短縮、CRLF/途中CR、surrogate断片、長大行、同時入力、既存結果の非破壊性も検査する。

同じ`stream` probeを本体変更後に独立プロセスで2回、最終ソースでCodeText直接をもう1回実行した。
1,500行への32回の追記で、syntax Workerの往復は次の通り：

| 経路 | 修正前の平均 | 修正後の平均 | 修正後の実行済み/採用job |
| --- | ---: | ---: | ---: |
| CodeText直接 | 129–142ms | 23–25ms | 32/32 |
| Markdown内 | 131–132ms | 22–27ms | 10/10 |

CodeText直接では修正前の実行済み10–11件に対し採用1件だった状態から、
今回の32回はキャンセル0件で全結果を採用できた。Markdownの既存100ms samplerはそのまま。
往復には全tokensのclone/配送/受取待ちを含み、変更後もその全量転送は残る。
修正前後は別実行で、負荷を完全に固定したpaired測定ではない。

これは解析処理の実装・測定結果であり、DOM大幅削減の試作が完成したわけではない。
実アプリの問題の会話・メモリ増加・長時間操作の解消も引き続き未確認。

最終検証：

- 直接`tsc`・`tsgo`、全体`pnpm lint`、`git diff --check`：通過。
- 必須の全体`pnpm test:ui`：**26 passed / 0 failed**。
- syntax engine/色分け/保持の対象unit：**45 passed / 0 failed**。
- 全体`pnpm test`の最終実行：**1,029 passed / 1 failed**。
  残る失敗は以前からの`ChatOpening.test.tsx`隔離子プロセス内の
  モデル区切りSVG位置と「New chat」ボタン数のassertion。同ファイルは今回変更していない。
- 初回の全体unitにはSDK packagingの一時ディレクトリrenameでWindows `EPERM`もあった。
  変更せず隔離実行13件と次の全体実行で通過。assertion・timeoutは緩めていない。
- LSPはエラー0件だったがpush-onlyでclean確認不完全。直接コンパイラの結果を根拠にした。

直前1件だけのため、大きな出力が交互に変わる場合は再利用が減る。変更のないprefixが
確認できないケースで速さのために古い色を使うことはせず、従来と一致する再解析に戻る。

## 7. DOM削減の本体実装と最終検証

`HighlightedCode.tsx`の標準コードと構文色付き差分を、`SyntaxText.tsx`／`syntax-paint.ts`の
表示範囲Range方式へ切り替えた。**保存済み内容だけでなく、配信開始時から使用する。**
完了時に別のDOM構造へ切り替えない。

- 色だけのtokenをspanにしない。1行の無装飾部分をまとめ、太字・斜体・下線等には従来と同じ
  色・背景・font classのspanを残す。差分の追加/削除の全幅背景と行番号も従来要素のまま。
- 文字はReactの全文代入ではなく、`CharacterData.replaceData`で最小の変更部分だけ更新する。
  改行を追加しても既存行のtext nodeを置き換えず、同じ行への追記でも既存の選択・注釈Rangeを保持する。
- 全文はDOMに残す。限定するのは色Rangeの登録範囲だけ。viewport・内側スクロール・折返しを測り、
  表示範囲と先読み範囲を描く。行の矩形は二分探索し、差分は共通preでまとめる。
- 色Rangeのpoolは現在描画中の数までにし、訪れた全行のRangeは保持しない。
  未使用の色rule、unmountしたsource、observer/listenerも解放する。描画は必要な更新時のみで、常時rAFは回さない。
- API非対応環境とユーザー拡張Rendererは従来描画。設定Cardも従来どおり。
  組込apply_patchは登録オブジェクトの同一性で区別して新方式を使う。
  ユーザーRendererが同じIDを名乗っても組込扱いしない。
- 最初から巨大で色分け対象外の入力は従来のleanなplain textに留める。
  配信中に巨大化した場合も物理行slotを2,000個までにし、残りの**全文**を最後のtext nodeへ保持する。
  内容・読み込み済み履歴・表示キャッシュは破棄しない。通常ターミナルの既存コンパクト方式は維持。

### 本体による比較

同じ200出力×80行の`ranges` probeで、従来compactを明示的に使う対照と、本体の新方式を比較。
順序を逆にした別プロセスでも確認した（GPU無効の独立Edge）。

| 指標 | 前回compact | 今回の本体 |
| --- | ---: | ---: |
| Text nodeを含むDOM総数 | 336,000 | 48,200 |
| 要素数 | 128,200 | 16,400 |
| 幅変更＋同期layoutの平均 | 108–113ms | 24ms前後 |
| scrollのみの最大rAF間隔 | 約16.8ms | 約16.8ms |

**前回比で総DOM約86%減。** 無色化、内容の省略、応答の仮想化による数字ではない。

本番`Chat`の保存済みコード回答200件＋短い配信中回答も再測定：
総DOMは347,432→60,032。先頭を読みながら/末尾追従の双方で、
同期commit平均約3.7ms、最大rAF間隔約16.8ms、先頭コードのDOM mutation 0回だった。
修正前の同じfixtureでは最大約50–67msの間隔があったが、別実行であり、
実会話のp95や長時間CPUの改善量を確定した結果ではない。

### 互換性と検証

`syntax-ranges-ui.test.ts`は、従来構造を独立対照にして次を検査する。

- 全文・改行・native全選択文字列、全非空白文字の色/背景/font/装飾、スクロール寸法。
- TSの継承class、Cのdirective、Rust macro、Markdown字体、ANSI RGB/背景、CRLF。
- ClearTypeの実画素を従来の同じ先頭glyphと厳密比較。注釈が重なる場合も比較する。
  全文全glyphの画素byte同一性まで主張するものではない。
- 逆方向の選択端点・実Rangeのnode同一性、別行と同じ行への追記/編集、配信中の同一構造。
- 実際の8行previewの内側スクロールとtrusted wheel、新たに見える行の色、Range数の上限。
- 空行と折り返す論理行が混在する狭いpreviewでも、複数のスクロール位置で可視文字の色を検査。
- 実注釈hookの選択範囲と優先度、組込patchへの適用、ユーザーRendererのfallback、
  大きなplain入力、unmount時の全syntax Range解放。

従来の描画回帰検査は削除・緩和せず、色の取得先をorigin elementから実際のHighlight描画にも対応させた。
Markdownの完全DOM oracle比較は従来描画同士の明示的な対照に保った。
以前失敗していた`ChatOpening.test.tsx`の2assertionは、現行の共通UI規約に合わせ、
tooltipから見えるモデル名を分離し、SVG順序・完全名tooltip・各ラベルを厳密に検査するよう修正。
「New chat」もsidebar 2個＋必須pane 1個をそれぞれ厳密に検査し、disabled検査は維持した。

最終確認：直接tsc/tsgo、全体Lint、本番frontend Vite build、標準unit **1,033/0**、
必須の全体UI **27/0**、`git diff --check`が通過。
frontend buildは一時出力先を使って削除し、生成SDKや配布版は更新していない。

ここまででコード/差分DOMと再解析の実装・回帰検証を完了した。
**実行中の問題の会話のheap/CPU trace、ホストprivate約3.5GiBの原因確定、
インストール版の更新・再起動は行っていない。** 合成DOM削減率を実アプリ全体のメモリ削減率と扱わない。

## 8. 逐次表示時のハイライトのちらつき再確認

ユーザーの懸念を受け、`syntax-streaming-ui.test.ts`を追加した。本体実装はこの再確認では変更していない。
既存の「解析待ち中も変わっていない部分の色を保持する」処理を、新しいRange描画でも検査する。

- CodeText直接と`Markdown streaming=true`の両経路で、構文/Markdown Workerを意図的に保留する。
  32msの追記と100ms samplerをまたぐ更新、文字列の続き・改行・空行・未閉鎖fence・最終完了を含む。
- 各rAFで、既存の色が残ること、同じpre/text nodeが接続していること、逆方向選択と実Rangeの端点を検査する。
- 選択ハイライトで色抜けを隠さないよう、未選択の数字glyphの実画素を、解析保留中・fence終了時・
  解析完了後にも比較する。色の登録を一時的に外せば検査が失敗する感度対照を含める。
- 追加した最新部分は、対応する解析結果が届いてから色が付くことと、古い非同期結果で戻らないことも確認する。

独立Edgeの初回実行でdirect 67 frame、Markdown 65 frameを観測し、既存色の消失・DOM差替えは0件、
未選択glyphも一致した。これは確認した条件での非再発であり、実際の会話でのGPU合成や
長時間動作を含む「絶対にちらつかない」の保証ではない。既存の色分けサイズ上限等の仕様も変更していない。

追加後の直接TypeScript・全体Lint・標準unit 1,033/0、全体UI 28/0も通過した。
初回の全体UIには並行改修中のAppから削除済みhelperをimportする一時的なsearch fixture build失敗があったが、
当該ファイルをこちらで変更せず、単独再実行と次の全体実行で通過した。
最終UI実行中にもHEADは`d12be23`→`0e4f3ba`と変わっており、固定treeによる長期性能比較ではない。
