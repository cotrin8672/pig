import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { ArchiveToggle } from "../../mainview/ArchiveToggle";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Domain/ArchiveToggle",
  component: ArchiveToggle,
  parameters: { gallery: true },
} satisfies Meta<typeof ArchiveToggle>;

function ChatArchive({
  count = 3,
  initial = false,
}: {
  count?: number;
  initial?: boolean;
}) {
  const [active, setActive] = useState(initial);
  return (
    <ArchiveToggle
      active={active}
      count={count}
      archiveLabel="アーカイブ済みチャット"
      backLabel="チャット一覧に戻る"
      onToggle={() => setActive(!active)}
    />
  );
}

export const States = {
  name: "ArchiveToggle",
  render: () => (
    <PrimitiveSpecimen
      layer="Domain"
      wide
      title="ArchiveToggle"
      intro="サイドバーで通常一覧とアーカイブ一覧を切り替えます。アーカイブが0件なら通常一覧にボタンは表示されません。"
      context="チャット一覧の末尾"
      variants={[
        { label: "アーカイブ一覧を表示中", sample: <ChatArchive initial /> },
        { label: "0件（非表示）", sample: <ChatArchive count={0} /> },
      ]}
    >
      <ChatArchive />
    </PrimitiveSpecimen>
  ),
};
