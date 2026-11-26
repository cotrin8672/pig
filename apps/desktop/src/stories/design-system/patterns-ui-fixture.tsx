import { useId, useRef, useState } from "react";
import { ActionsMenu } from "../../mainview/patterns/ActionsMenu";
import { ConfirmButton } from "../../mainview/patterns/ConfirmButton";
import { InlineRename } from "../../mainview/patterns/InlineRename";
import { CatalogPage, CatalogSection, Example } from "./ReviewPage";

function SettingsExample() {
  const id = useId();
  const [name, setName] = useState("レビュー用");
  const [enabled, setEnabled] = useState(true);
  return (
    <CatalogPage
      title="設定を部品で組み立てる"
      intro="SettingSection → SettingRow → 入力部品という構成案です。Settings.tsxの実装を抽出・変更せず、Storybook内だけで配置を確認します。"
    >
      <Example
        title="SettingSection / SettingRow / Field"
        evidence="構成案"
        source="Storybook専用レイアウト＋既存の入力スタイル"
        use="関連する設定をまとめ、設定名・説明・操作を揃える。"
        avoid="各設定で配置を描き直す。長文編集・複雑なフォームを万能な設定行に押し込む。"
      >
        <div className="ds-review-setting">
          <label htmlFor={`${id}-name`}>
            <strong>表示名</strong>
            <span className="ds-review-note">このStory内の表示名です。</span>
          </label>
          <input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="ds-review-setting">
          <label htmlFor={`${id}-enabled`}>
            <strong>通知のサンプル</strong>
            <span className="ds-review-note">
              実際の通知設定は変更しません。
            </span>
          </label>
          <input
            id={`${id}-enabled`}
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
        </div>
      </Example>
      <CatalogSection title="部品の境界">
        <p>
          Fieldは入力とラベルの関係、SettingRowは配置、SettingSectionはグループを担当します。保存・通信・設定の正本は外側に残します。
        </p>
      </CatalogSection>
    </CatalogPage>
  );
}

function InteractionExamples() {
  const [confirmed, setConfirmed] = useState(0);
  const [name, setName] = useState("サンプルの名前");
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState("未操作");
  const renameButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <CatalogPage
      title="操作・確認・その場編集を使い分ける"
      intro="既存部品は本番TSXを直接表示しています。Dialogだけはネイティブ要素を使った構成案です。すべてサンプル内の操作で完結します。"
    >
      <div className="ds-review-grid">
        <Example
          title="ActionsMenu"
          evidence="既存部品"
          source="mainview/patterns/ActionsMenu.tsx"
          use="対象に対する補助的な操作をまとめる。"
          avoid="モデルなどの値を選ぶ用途。重要な主操作を全て隠すこと。"
        >
          <div className="ds-review-menu-row">
            <span>サンプル項目</span>
            <ActionsMenu label="サンプル項目の操作">
              {(close) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAction("編集を選択");
                      close();
                    }}
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAction("複製を選択");
                      close();
                    }}
                  >
                    複製
                  </button>
                </>
              )}
            </ActionsMenu>
          </div>
          <output aria-live="polite">{action}</output>
        </Example>
        <Example
          title="ConfirmButton"
          evidence="既存部品"
          source="mainview/patterns/ConfirmButton.tsx"
          use="軽い二度押し確認。一定時間・Escape・blurで解除される。"
          avoid="詳しい説明や追加の入力が必要な確認。処理の重大さを二度押しだけで説明すること。"
        >
          <ConfirmButton onConfirm={() => setConfirmed(confirmed + 1)}>
            サンプルを確定
          </ConfirmButton>
          <output aria-live="polite">確定回数: {confirmed}</output>
        </Example>
        <Example
          title="InlineRename"
          evidence="既存部品"
          source="mainview/patterns/InlineRename.tsx"
          use="短い名前のその場編集。Enter・blurで確定、Escapeで取消。"
          avoid="長文編集や複数項目の編集。IMEの確定を保存と混同すること。"
        >
          {editing ? (
            <InlineRename
              value={name}
              label="サンプルの名前"
              onCommit={setName}
              onDone={() => {
                setEditing(false);
                requestAnimationFrame(() => renameButton.current?.focus());
              }}
            />
          ) : (
            <button
              type="button"
              ref={renameButton}
              onClick={() => setEditing(true)}
            >
              {name}を変更
            </button>
          )}
        </Example>
        <Example
          title="Dialog候補"
          evidence="構成案"
          source="ネイティブdialog / Storybook専用の確認内容"
          use="説明を読んで明示的に回答する必要があるとき。"
          avoid="短い非対話の補足や、操作を妨げる必要のない情報表示。"
        >
          <button type="button" onClick={() => dialog.current?.showModal()}>
            確認の見本を開く
          </button>
          <dialog
            ref={dialog}
            className="ds-review-dialog"
            aria-labelledby={titleId}
          >
            <form method="dialog">
              <h2 id={titleId}>確認内容のサンプル</h2>
              <p>
                これは構成を確認するための見本です。閉じてもアプリへの操作・保存は行いません。
              </p>
              <button type="submit" className="primary">
                閉じる
              </button>
            </form>
          </dialog>
        </Example>
      </div>
    </CatalogPage>
  );
}

export const Settings = {
  name: "01 · 設定の組み合わせ",
  render: () => <SettingsExample />,
};
export const Interactions = {
  name: "02 · メニュー・確認・名前変更",
  render: () => <InteractionExamples />,
};
