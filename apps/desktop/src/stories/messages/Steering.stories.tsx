import { UserMessage } from "../../mainview/MessageContent";
import { ToolBlock } from "../../mainview/ToolBlock";
import { bash } from "../proposals/data";
import { atPhase } from "../proposals/kit";

type Args = { phase: "pending" | "read" };
const steer =
  "どんだけ時間かけてるの。テストは greeting だけに絞って先に結果を見せて";

/** The built-in steering line: queued at the composer, then read at the next step. */
function Steering({ phase }: Args) {
  return (
    <>
      <div className="response-turn">
        <article className="message assistant">
          <ToolBlock
            {...atPhase(bash, phase === "read" ? "done" : "running")}
          />
        </article>
      </div>
      <div className="response-turn">
        <article className="message user">
          <UserMessage
            sessionId="preview"
            disabled
            steer={phase}
            message={{
              role: "user",
              timestamp: Date.UTC(2026, 10, 12, 3, 30),
              content: steer,
            }}
          />
        </article>
      </div>
      {phase === "read" && (
        <div className="response-turn">
          <article className="message assistant">
            <p>
              すみません、全体のテストを待っていました。greeting
              に絞って先に結果を出します。
            </p>
          </article>
        </div>
      )}
    </>
  );
}

export default {
  title: "Chat/Messages/Steering",
  args: { phase: "pending" } satisfies Args,
  argTypes: {
    phase: { control: "inline-radio", options: ["pending", "read"] },
  },
};
export const Default = { render: (args: Args) => <Steering {...args} /> };
