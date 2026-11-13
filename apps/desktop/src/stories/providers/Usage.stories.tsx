import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { ProviderUsageView } from "../../mainview/ProviderUsageView";
import {
  type DockVariant,
  SidebarWithDock,
  UsageDisplaySetting,
  UsageDock,
} from "./UsageDock";
import { UsagePage } from "./UsagePreviews";
import { type UsageDisplay, type UsageEntry, usage } from "./usage-data";
import { usageFixtures, usageFixtureTime } from "./usage-fixtures";

export default {
  title: "Providers/Usage Meter",
  parameters: { gallery: true },
} satisfies Meta;

const healthy: UsageEntry[] = usage.filter((e) =>
  ["codex-2", "openrouter", "mistral"].includes(e.key),
);

type Args = { display: UsageDisplay };
const displayArg = {
  args: { display: "remaining" } as Args,
  argTypes: {
    display: {
      control: "inline-radio" as const,
      options: ["remaining", "used"],
      name: "使用量の表示",
    },
  },
};

/** The setting drives every preview on the page, as it will in the app. */
export const Implemented = {
  name: "Implemented / 18px sidebar dock",
  ...displayArg,
  render: ({ display }: Args) => (
    <div
      className="sidebar"
      style={{ width: "var(--ds-sidebar-width)", paddingTop: 12 }}
    >
      <ProviderUsageView
        entries={usageFixtures}
        display={display}
        now={usageFixtureTime}
        onRefresh={() => {}}
      />
    </div>
  ),
};

export const Overview = () => {
  const [display, setDisplay] = useState<UsageDisplay>("remaining");
  return (
    <div className="usage-root">
      <section>
        <h2>サイドバー常設の使用量（1行=1アカウント）</h2>
        <p>
          取得経路がないProviderは表示しません。リセットは言語に関係なく
          1日以内なら「1h
          12m」「45m」「12s」、それ以降は「12/1」。正確な日時は行にマウスを乗せると表示されます。
        </p>
        <UsageDisplaySetting value={display} onChange={setDisplay} />
        <div className="ud-stage">
          <SidebarWithDock display={display} />
          <SidebarWithDock entries={healthy} display={display} />
          <SidebarWithDock collapsed display={display} />
        </div>
      </section>
    </div>
  );
};

export const Dock = {
  name: "Dock / all providers",
  ...displayArg,
  render: ({ display }: Args) => (
    <div style={{ width: 240 }}>
      <UsageDock display={display} />
    </div>
  ),
};

const ideas: { variant: DockVariant; title: string; note: string }[] = [
  {
    variant: "bars",
    title: "現在",
    note: "容量だけ。時間はリセット列の文字で",
  },
  {
    variant: "nested",
    title: "A. 入れ子",
    note: "薄い外側=リセットまでの時間、内側の線=容量。高さ5px",
  },
  {
    variant: "tick",
    title: "B. 目盛り",
    note: "線=容量、縦の目盛り=リセットまでの時間。線が目盛りより短い=リセット前に尽きそう",
  },
  {
    variant: "ring",
    title: "C. 二重リング",
    note: "外周=時間、内周=容量。コンテキスト表示の円と同系統",
  },
];

/** Same 20px rows and 30px bar column; only the bar drawing differs. */
export const CompactIdeas = {
  name: "Ideas / time in the bar",
  ...displayArg,
  render: ({ display }: Args) => (
    <div className="ud-ideas">
      {ideas.map((idea) => (
        <figure key={idea.variant}>
          <figcaption>
            <strong>{idea.title}</strong>
            <span>{idea.note}</span>
          </figcaption>
          <UsageDock display={display} variant={idea.variant} />
        </figure>
      ))}
    </div>
  ),
};

/** Double ring at a few sizes, inside the real sidebar width. */
export const RingSizes = {
  name: "Ideas / ring sizes",
  ...displayArg,
  render: ({ display }: Args) => (
    <div className="ud-ideas">
      {[
        { size: 13, note: "今の案（行20px）" },
        { size: 16, note: "行20pxのまま" },
        { size: 18, note: "行22px" },
        { size: 20, note: "行24px" },
      ].map(({ size, note }) => (
        <figure key={size}>
          <figcaption>
            <strong>{size}px</strong>
            <span>{note}</span>
          </figcaption>
          <UsageDock display={display} variant="ring" ringSize={size} />
        </figure>
      ))}
    </div>
  ),
};

export const DockCollapsed = {
  name: "Dock / collapsed",
  ...displayArg,
  render: ({ display }: Args) => (
    <div style={{ width: 240 }}>
      <UsageDock collapsed display={display} />
    </div>
  ),
};

export const Setting = {
  name: "Settings / usage display",
  render: () => {
    const [display, setDisplay] = useState<UsageDisplay>("remaining");
    return (
      <div className="usage-root">
        <UsageDisplaySetting value={display} onChange={setDisplay} />
        <div style={{ width: 240 }}>
          <UsageDock display={display} />
        </div>
      </div>
    );
  },
};

export const Sidebar = {
  name: "Sidebar",
  ...displayArg,
  render: ({ display }: Args) => <SidebarWithDock display={display} />,
};

export const Page = {
  name: "Detail page",
  ...displayArg,
  render: ({ display }: Args) => (
    <div className="usage-root">
      <UsagePage display={display} />
    </div>
  ),
};
