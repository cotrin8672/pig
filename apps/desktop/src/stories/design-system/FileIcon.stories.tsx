import type { Meta } from "@storybook/react-vite";
import { FileIcon } from "../../mainview/primitives/FileIcon";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/FileIcon",
  component: FileIcon,
  parameters: { gallery: true },
} satisfies Meta<typeof FileIcon>;

export const FileTypes = {
  render: () => (
    <PrimitiveSpecimen
      title="FileIcon"
      intro="ファイル名の拡張子で種類を区別します。判別できない名前には汎用アイコンを使います。"
      context="ファイル添付"
      variants={[
        "logs.zip",
        "voice.wav",
        "clip.mp4",
        "data.csv",
        "notes.md",
        "main.ts",
        "LICENSE",
      ].map((name) => ({
        label: name,
        sample: <FileIcon name={name} size={28} />,
      }))}
    >
      <div className="ds-specimen-line">
        <FileIcon name="notes.md" size={28} />
        notes.md
      </div>
    </PrimitiveSpecimen>
  ),
};
