import type { ComponentProps } from "react";
import { TurnSpinner } from "../../mainview/primitives/TurnSpinner";
import type { Proposal } from "./kit";
import "./running.css";

export function RunningLine({
  variant,
}: Pick<ComponentProps<typeof TurnSpinner>, "variant">) {
  return (
    <p className="pp-run">
      <TurnSpinner variant={variant} />
      <span>処理中</span>
    </p>
  );
}

export const runningProposals = {
  Spinner: {
    title: "点字スピナー",
    fit: "点字一マスの輪郭を光点が巡り、後ろの点ほど小さく薄く消えていく。",
    View: () => <RunningLine variant="Spinner" />,
  },
  Dots: {
    title: "波打つ3点",
    fit: "三つの点が順に跳ねる。",
    View: () => <RunningLine variant="Dots" />,
  },
  Bars: {
    title: "信号バー",
    fit: "4本のバーが脈打つ。",
    View: () => <RunningLine variant="Bars" />,
  },
} satisfies Record<string, Proposal<object>>;
