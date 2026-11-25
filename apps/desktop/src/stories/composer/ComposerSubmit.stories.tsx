import type { Meta } from "@storybook/react-vite";
import { ComposerSubmit } from "../../mainview/ComposerSubmit";
import { CatalogPage } from "../design-system/ReviewPage";
import "../../mainview/composer.css";

export default {
  id: "design-system-features-composer-submit",
  title: "Design System/Domain/ComposerSubmit",
  parameters: { gallery: true },
} satisfies Meta;

const states = [
  { title: "送信", busy: false, hasContent: true, disabled: false },
  { title: "空入力", busy: false, hasContent: false, disabled: true },
  {
    title: "応答中・空入力 → 停止",
    busy: true,
    hasContent: false,
    disabled: false,
  },
  {
    title: "応答中・追加入力 → 送信",
    busy: true,
    hasContent: true,
    disabled: false,
  },
  {
    title: "送信待ち",
    busy: false,
    hasContent: true,
    disabled: false,
    waiting: true,
  },
  {
    title: "停止確認中",
    busy: true,
    hasContent: false,
    disabled: false,
    stopping: true,
  },
  {
    title: "中断後・空入力 → 再開",
    busy: false,
    hasContent: false,
    disabled: false,
    resumable: true,
  },
] as const;

export const ComposerActions = {
  name: "ComposerSubmit",
  render: () => (
    <CatalogPage
      title="ComposerSubmit"
      intro="ComposerSubmitの本番実装を、状態ごとに直接表示します。実Composerや通信は起動せず、送信・停止の操作は接続しません。"
    >
      <div className="ds-review-grid">
        {states.map(({ title, ...state }) => (
          <section key={title}>
            <h3>{title}</h3>
            <form
              className="ds-review-submit"
              onSubmit={(event) => event.preventDefault()}
            >
              <ComposerSubmit {...state} onStop={() => {}} />
            </form>
          </section>
        ))}
      </div>
    </CatalogPage>
  ),
};
