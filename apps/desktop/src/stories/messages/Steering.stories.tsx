import { stories } from "../proposals/kit";
import {
  type SteerArgs,
  SteerDefault,
  steerProposals,
} from "../proposals/steer";

export default {
  title: "Chat/Messages/Steering",
  // Each preview draws its own turns: the running step, the steering message and the reply.
  parameters: { gallery: true },
  args: { phase: "pending" } satisfies SteerArgs,
  argTypes: {
    phase: { control: "inline-radio", options: ["pending", "applied"] },
  },
};
const all = stories(steerProposals, SteerDefault, (args: SteerArgs) => args);
export const Default = all.Default;
export const Compare = all.Compare;
export const Insertion = all.Insertion;
export const Receipt = all.Receipt;
export const AgentStatus = all.AgentStatus;
