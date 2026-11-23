import type { Meta } from "@storybook/react-vite";
import { Composer } from "../../mainview/Composer";
import { drafts, emptyContent } from "../../mainview/draft-store";
import { useStore } from "../../mainview/store";
import { setQueuedPreview } from "../browser-rpc";
import { installPreview, previewDefaults } from "../current-ui/fixtures";
import { PreviewTheme } from "../current-ui/Previews";

const labels = [
  "空入力・送信不可",
  "入力済み・送信可能",
  "応答中",
  "キューあり",
];
const sessionId = (i: number) => `preview-composer-${i}`;

export default {
  id: "domain-composer-ui",
  title: "Design System/Features/Composer",
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
      transcript: { ...base.transcript, running: i >= 2 },
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
      {labels.map((label, i) => (
        <section
          key={label}
          className="composer-story-state"
          aria-label={label}
        >
          <h3>{label}</h3>
          <Composer snapshot={useStore.getState().snapshots[sessionId(i)]} />
        </section>
      ))}
    </PreviewTheme>
  ),
};
