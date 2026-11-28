import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import { Button } from "../../mainview/primitives/Button";
import { SessionPanel } from "../../mainview/SessionPanel";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import {
  activityFixture,
  installPreview,
  type PreviewArgs,
  previewArgTypes,
  previewDefaults,
  supportedExtensionsFixture,
} from "./fixtures";
import { PreviewTheme } from "./Previews";

const meta = {
  title: "Design System/Domain/SessionPanel",
  parameters: { gallery: true },
  args: previewDefaults,
  argTypes: previewArgTypes,
  beforeEach: ({ args }) => installPreview(args),
  render: (args) => (
    <PreviewTheme args={args}>
      <PanelSample />
    </PreviewTheme>
  ),
} satisfies Meta<PreviewArgs>;
export default meta;

const samples = [
  { label: "作業の進捗", fixture: activityFixture, tab: undefined },
  {
    label: "対応拡張の件数",
    fixture: supportedExtensionsFixture,
    tab: undefined,
  },
  {
    label: "実行中のサブエージェント",
    fixture: supportedExtensionsFixture,
    tab: "tasks",
  },
  {
    label: "予約プロンプト",
    fixture: supportedExtensionsFixture,
    tab: "schedule",
  },
] as const;

function PanelSample() {
  const [{ index, revision }, select] = useState({ index: 0, revision: 0 });
  const { fixture, label, tab } = samples[index];
  const state = useMemo(
    () => fixture(`standalone-activity-${revision}`),
    [fixture, revision],
  );
  return (
    <PrimitiveSpecimen
      layer="Domain"
      wide
      title="SessionPanel"
      intro="Composerの件数チップから、作業の進捗・サブエージェント・予約を開きます。"
      context={label}
      variants={samples.map(({ label }, next) => ({
        label,
        sample: (
          <Button
            aria-label={`${label}の見本を表示`}
            aria-pressed={index === next}
            onClick={() =>
              select(({ revision }) => ({
                index: next,
                revision: revision + 1,
              }))
            }
          >
            表示
          </Button>
        ),
      }))}
    >
      <div className="current-ui-activity-anchor">
        <div className="composer current-ui-activity-composer">
          <div className="composer-toolbar">
            <div className="composer-session">
              <SessionPanel
                key={state.generation}
                state={state}
                sessionId={state.generation}
                initialTab={tab}
                onAction={async () => {}}
                onReload={async () => {}}
              />
            </div>
          </div>
        </div>
      </div>
    </PrimitiveSpecimen>
  );
}

export const States: StoryObj<typeof meta> = { name: "SessionPanel" };
