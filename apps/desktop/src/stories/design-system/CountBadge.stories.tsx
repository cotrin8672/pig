import type { Meta } from "@storybook/react-vite";
import { Bell } from "lucide-react";
import { CountBadge } from "../../mainview/CountBadge";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Domain/CountBadge",
  component: CountBadge,
  parameters: { gallery: true },
} satisfies Meta<typeof CountBadge>;

export const States = {
  name: "CountBadge",
  render: () => (
    <PrimitiveSpecimen
      layer="Domain"
      title="CountBadge"
      intro="未読件数を表示します。0件なら消え、100件からは「99+」に収めます。"
      context="通知センター"
      variants={[0, 1, 99, 100].map((count) => ({
        label: `${count}件${count === 0 ? "（非表示）" : ""}`,
        sample: <CountBadge count={count} />,
      }))}
    >
      <div className="ds-specimen-line">
        <Bell size={18} aria-hidden="true" /> 通知 <CountBadge count={3} />
      </div>
    </PrimitiveSpecimen>
  ),
};
