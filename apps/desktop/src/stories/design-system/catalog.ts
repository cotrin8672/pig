export const layers = [
  {
    name: "Foundations",
    purpose: "色・文字・面・余白・動きの基準",
    boundary: "部品やセッションの都合ではなく、UI全体の意味を定義する。",
    components: "Color / Typography / Surface / Spacing / Motion",
  },
  {
    name: "Primitives",
    purpose: "単一の操作・入力・表示",
    boundary:
      "押す、入力する、状態を示す。モデル・セッション・通信は知らない。",
    components: "Button / IconButton / TextField / Select / Checkbox / Badge",
  },
  {
    name: "Patterns",
    purpose: "繰り返し登場するUI上の目的",
    boundary:
      "設定を編集する、検索して選ぶ、確認する。pig固有の判断は持たない。",
    components:
      "Field / SettingRow / ListRow / ActionsMenu / Dialog / OutputFrame",
  },
  {
    name: "Domain",
    purpose: "pigの意味を持つ表示・操作",
    boundary:
      "モデル・会話・実行・承認を知る。具体的な通信やネイティブ処理は外から渡す。",
    components: "Composer / ModelPicker / SessionRow / ToolResult / AgentRun",
  },
  {
    name: "Screens",
    purpose: "部品を組み合わせた画面・利用シナリオ",
    boundary: "配置と導線を確認する。部品の見た目を画面ごとに描き直さない。",
    components: "会話 / 設定 / セッション一覧 / 分割Pane / 将来のスマホ画面",
  },
] as const;

export type Layer = (typeof layers)[number]["name"];
export type Evidence = "既存部品" | "既存CSS" | "構成案";

export const inventory: {
  layer: Layer;
  name: string;
  evidence: Evidence;
  source: string;
  plan: string;
}[] = [
  {
    layer: "Foundations",
    name: "Color / Typography / Shape",
    evidence: "既存CSS",
    source: "tokens.css",
    plan: "既存トークンを正本とし、別の配色・文字体系を作らない。",
  },
  {
    layer: "Foundations",
    name: "Surface / Scroll / Motion",
    evidence: "既存CSS",
    source: "styles.css・docs/ui-guidelines.md",
    plan: "面の役割、透過、端の余白、状態変化の基準を整理する。",
  },
  {
    layer: "Primitives",
    name: "Button / IconButton",
    evidence: "既存CSS",
    source: "styles.css",
    plan: "まず既存スタイルを展示する。共通React APIは未確定。",
  },
  {
    layer: "Primitives",
    name: "TextField / Select / Checkbox",
    evidence: "既存CSS",
    source: "styles.css",
    plan: "ネイティブ要素と既存スタイルを土台に、用途と状態を揃える。",
  },
  {
    layer: "Primitives",
    name: "Badge / StatusDot / Separator",
    evidence: "構成案",
    source: "各画面に分散",
    plan: "属性・未読・実行状態を混同しない。全てをBadgeへ統合しない。",
  },
  {
    layer: "Patterns",
    name: "Field / SettingRow / SettingSection",
    evidence: "構成案",
    source: "Settings.tsx内の構成",
    plan: "ラベル・説明・入力の関連付けと配置を共通化する候補。",
  },
  {
    layer: "Patterns",
    name: "ActionsMenu",
    evidence: "既存部品",
    source: "ActionsMenu.tsx",
    plan: "既存実装をそのまま展示。値の選択ではなく操作の一覧に使う。",
  },
  {
    layer: "Patterns",
    name: "ConfirmButton",
    evidence: "既存部品",
    source: "ConfirmButton.tsx",
    plan: "二度押し確認。説明・追加入力が必要な確認はDialogに分ける。",
  },
  {
    layer: "Patterns",
    name: "InlineRename",
    evidence: "既存部品",
    source: "InlineRename.tsx",
    plan: "短い名前のその場編集。長文編集や複数項目のフォームには使わない。",
  },
  {
    layer: "Patterns",
    name: "Popover / Dialog / SearchableSelect",
    evidence: "構成案",
    source: "Picker・UIRequestBroker等",
    plan: "見た目だけで統合せず、focus・閉じ方・選択の意味から境界を決める。",
  },
  {
    layer: "Patterns",
    name: "OutputFrame",
    evidence: "構成案",
    source: "ToolBlock.tsx等",
    plan: "出力枠の左右端・約8行・枠内スクロールを揃える。内容の描画とは分離。",
  },
  {
    layer: "Domain",
    name: "ComposerSubmit / EffortChip",
    evidence: "既存部品",
    source: "ComposerSubmit.tsx・EffortChip.tsx",
    plan: "小さくてもpig固有の意味を持つ部品。今回、本番実装を直接展示する。",
  },
  {
    layer: "Domain",
    name: "Composer / ModelPicker / SessionList",
    evidence: "既存部品",
    source: "同名の本番TSX",
    plan: "今回は移動・置換しない。通信・storeとの境界と必要な状態を先にレビューする。",
  },
  {
    layer: "Domain",
    name: "ToolResult / AgentRun / Request",
    evidence: "構成案",
    source: "ToolBlock・SessionPanel・UIRequestBroker",
    plan: "既存の表示契約を活かし、汎用の枠とドメインの意味を分ける候補。",
  },
  {
    layer: "Screens",
    name: "会話 / 設定 / セッション一覧",
    evidence: "構成案",
    source: "App・Settings・SidebarSessions",
    plan: "画面単位の組み合わせ例。実アプリの起動・接続は行わない。",
  },
];

export const decisions = [
  {
    need: "処理を実行する",
    use: "Button / IconButton",
    avoid: "移動にはLink。クリック可能なdivを作らない。",
  },
  {
    need: "操作候補をまとめる",
    use: "ActionsMenu",
    avoid: "モデルなどの値の選択には使わない。",
  },
  {
    need: "候補から値を選ぶ",
    use: "Select / SearchableSelect",
    avoid: "少数ならRadioGroupも候補。何でもPickerにしない。",
  },
  {
    need: "入力に名前・説明を付ける",
    use: "Field",
    avoid: "placeholderだけでラベルを代用しない。",
  },
  {
    need: "設定を並べる",
    use: "SettingSection + SettingRow + 入力部品",
    avoid: "設定ごとに余白・ラベル配置を作り直さない。",
  },
  {
    need: "短い説明を補う",
    use: "Tooltip",
    avoid: "必須情報や複数の値・日時を閉じ込めない。",
  },
  {
    need: "構造化した補足を見せる",
    use: "Popover",
    avoid: "hoverだけに頼らず、focus・タップでも情報へ到達できるようにする。",
  },
  {
    need: "明示的な回答・確認を求める",
    use: "Dialog / ConfirmDialog",
    avoid: "軽い二度押し確認はConfirmButton。見た目だけでPopoverと統合しない。",
  },
  {
    need: "コード・ログ・差分を読む",
    use: "OutputFrame + 内容のRenderer",
    avoid: "対話型Terminalや一般Markdownまで一律8行にしない。",
  },
  {
    need: "送信状態・失敗を知らせる",
    use: "既存のボタン状態・通知UI",
    avoid: "Composerの下にメッセージ行を追加しない。",
  },
];

export const reviewChecks = [
  "この部品の役割と、使わない場面を説明できるか",
  "既存部品・既存CSS・構成案の区別が分かるか",
  "通常・空・処理中・操作不可・失敗の必要な状態が揃うか",
  "狭い幅・長い文字・文字拡大で操作できるか",
  "キーボード操作・focus・アクセシブル名が保たれるか",
  "Cardの半透明、出力の整列、スクロールの共通ルールを守るか",
  "状態変化で周囲やComposerの位置が動かないか",
  "本番移行前に既存UIとの見た目・操作の比較と回帰テストを用意できるか",
];
