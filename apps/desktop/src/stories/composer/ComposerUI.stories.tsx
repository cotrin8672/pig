import type { Meta } from "@storybook/react-vite";
import { Composer } from "../../mainview/Composer";
import { drafts, emptyContent } from "../../mainview/draft-store";
import { useStore } from "../../mainview/store";
import { TooltipLayer } from "../../mainview/Tooltip";
import { setQueuedPreview } from "../browser-rpc";
import { installPreview, previewDefaults } from "../current-ui/fixtures";
import { PreviewTheme } from "../current-ui/Previews";
import "../../mainview/panes.css";

const labels = [
  "空入力・送信不可",
  "入力済み・送信可能",
  "応答中",
  "キューあり",
  "非アクティブPane",
  "未送信の引用が多数",
];
const inactive = 4;
const quoted = 5;
const sessionId = (i: number) => `preview-composer-${i}`;

export default {
  id: "domain-composer-ui",
  title: "Design System/Domain/Composer",
  parameters: { gallery: true },
  beforeEach: () => {
    const cleanup = installPreview(previewDefaults);
    const state = useStore.getState();
    const base = state.snapshots[state.active ?? ""];
    if (!base) {
      cleanup();
      throw new Error("Composer preview has no active chat.");
    }
    const snapshots = labels.map((_, i) => ({
      ...base,
      info: { ...base.info, id: sessionId(i) },
      address: { ...base.address, sessionId: sessionId(i) },
      transcript: { ...base.transcript, running: i >= 2 && i !== quoted },
    }));
    useStore.setState({
      snapshots: Object.fromEntries(snapshots.map((s) => [s.info.id, s])),
      active: sessionId(0),
    });
    drafts.receive(
      { ...base.address, sessionId: sessionId(1) },
      {
        revision: 1,
        text: "この変更を確認して",
        images: [],
        pastes: [],
      },
    );
    drafts.receive(snapshots[quoted].address, {
      ...emptyContent(),
      revision: 1,
      text: "引用した箇所について説明して",
      annotations: Array.from({ length: 12 }, (_, i) => ({
        id: `preview-quote-${i}`,
        quote: `${i + 1}. ${i % 2 ? "変更前と変更後で、この条件が同じになる理由を確認します。" : "テスト結果を確認"}`,
        comment: "この箇所をもう少し詳しく教えてください。",
      })),
    });
    setQueuedPreview({
      key: {
        ...base.address,
        sessionId: sessionId(3),
        requestId: "preview-followup",
      },
      version: 1,
      state: "sending",
      stage: "queued",
      delivery: "followUp",
      content: { ...emptyContent(), text: "次にテスト結果を確認して" },
    });
    return () => {
      setQueuedPreview();
      for (const s of snapshots) drafts.discard(s.address, true);
      cleanup();
    };
  },
} satisfies Meta;

export const Default = {
  name: "Composer",
  render: () => (
    <PreviewTheme args={previewDefaults}>
      <TooltipLayer>
        {labels.map((label, i) => (
          <section
            key={label}
            className={`current-ui-composer-story-state${i === inactive ? " pane-view" : ""}`}
            data-active={i === inactive ? false : undefined}
            aria-label={label}
          >
            <h3>{label}</h3>
            <Composer snapshot={useStore.getState().snapshots[sessionId(i)]} />
          </section>
        ))}
      </TooltipLayer>
    </PreviewTheme>
  ),
};
