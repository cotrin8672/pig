import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { ConfirmButton } from "../../mainview/ConfirmButton";

export default {
  title: "Design System/Patterns/ConfirmButton",
  component: ConfirmButton,
  parameters: { gallery: true },
} satisfies Meta<typeof ConfirmButton>;
export const Default = {
  render: function Example() {
    const [count, setCount] = useState(0);
    return (
      <section>
        <h1>ConfirmButton</h1>
        <p>2回押すと確定します。Escapeで取り消せます。</p>
        <ConfirmButton onConfirm={() => setCount((n) => n + 1)}>
          削除
        </ConfirmButton>
        <output>確定回数：{count}</output>
      </section>
    );
  },
};
