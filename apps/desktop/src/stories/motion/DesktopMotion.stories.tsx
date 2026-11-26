import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";
import { SegmentedControl } from "../../mainview/primitives/SegmentedControl";
import { installPreview, previewDefaults } from "../current-ui/fixtures";
import { DesktopPreview, PreviewTheme } from "../current-ui/Previews";
import { previewExits } from "./preview-exits";
import "./desktop-motion.css";

const profiles = [
  { value: "current", label: "現行" },
  { value: "glide", label: "滑らかに減速" },
  { value: "spring", label: "少し弾む" },
] as const;

function DesktopMotion() {
  const [profile, setProfile] =
    useState<(typeof profiles)[number]["value"]>("glide");
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (profile !== "current" && stage.current)
      return previewExits(stage.current);
  }, [profile]);
  return (
    <div className="desktop-motion">
      <header className="desktop-motion-guide">
        <div>
          <strong>デスクトップの操作感</strong>
          <p>
            左の「プロジェクト」欄で、フォルダーアイコン横の「pig」をクリックすると、
            配下のチャット一覧が開閉します。左下のベルと入力欄のモデル名はもう一度押して閉じ、
            歯車で開いた設定は「チャットに戻る」で戻れます。
          </p>
          <small>
            OSの「視差効果を減らす」が有効なため、試作の動きは停止中です。
          </small>
        </div>
        <SegmentedControl
          aria-label="動きの比較"
          options={profiles}
          value={profile}
          onChange={setProfile}
        />
      </header>
      <div className="desktop-motion-stage" data-motion={profile} ref={stage}>
        <PreviewTheme args={previewDefaults}>
          <DesktopPreview />
        </PreviewTheme>
      </div>
    </div>
  );
}

const meta = {
  title: "Prototypes/Desktop Motion",
  component: DesktopMotion,
  parameters: { appPreview: true },
  beforeEach: () => installPreview(previewDefaults),
} satisfies Meta<typeof DesktopMotion>;
export default meta;

export const Playground: StoryObj<typeof meta> = { name: "操作して比較" };
