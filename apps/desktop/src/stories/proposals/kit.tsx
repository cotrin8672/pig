import type { ChatRenderData } from "@pig/chat-renderers";
import type { ComponentType, ReactNode } from "react";
import { ToolBlock } from "../../mainview/ToolBlock";
import "./proposals.css";

export type Tool = ChatRenderData["tool"];
export type Phase = "done" | "running" | "error";
export type ToolProps = { tool: Tool; phase: Phase };
/** One display form, with the situation it is built for. */
export type Proposal<P> = {
  title: string;
  fit: string;
  View: ComponentType<P>;
};
/** Each tool fails in its own way, so fixtures carry their own error text. */
export type ToolFixture = { tool: Tool; error: string };

export function atPhase({ tool, error }: ToolFixture, phase: Phase): Tool {
  if (phase === "done") return tool;
  if (phase === "running") return { ...tool, live: true, state: undefined };
  return {
    ...tool,
    live: false,
    state: {
      status: "error",
      result: { content: [{ type: "text", text: error }] },
    },
  };
}

export const phaseControls = {
  args: { phase: "done" as Phase },
  argTypes: {
    phase: {
      control: "inline-radio" as const,
      options: ["done", "running", "error"],
    },
  },
};

function Specimen({
  index,
  title,
  fit,
  children,
}: {
  index: string;
  title: string;
  fit: string;
  children: ReactNode;
}) {
  return (
    <section className="pp-specimen">
      <header>
        <span>{index}</span>
        <strong>{title}</strong>
        <p>{fit}</p>
      </header>
      {children}
    </section>
  );
}

type Story<A> = { name?: string; render: (args: A) => ReactNode };
export function stories<K extends string, P extends object, A>(
  proposals: Record<K, Proposal<P>>,
  Default: ComponentType<P>,
  props: (args: A) => P,
) {
  const entries = Object.entries(proposals) as [K, Proposal<P>][];
  const result = {} as Record<K | "Default" | "Compare", Story<A>>;
  result.Default = { render: (args) => <Default {...props(args)} /> };
  entries.forEach(([key, { title, fit, View }], index) => {
    result[key] = {
      name: title,
      render: (args) => (
        <Specimen
          index={String(index + 1).padStart(2, "0")}
          title={title}
          fit={fit}
        >
          <View {...props(args)} />
        </Specimen>
      ),
    };
  });
  result.Compare = {
    name: "Compare all",
    render: (args) => (
      <div className="pp-compare">
        <Specimen index="00" title="Default" fit="現在の組み込みレンダラー。">
          <Default {...props(args)} />
        </Specimen>
        {entries.map(([key, { title, fit, View }], index) => (
          <Specimen
            key={key}
            index={String(index + 1).padStart(2, "0")}
            title={title}
            fit={fit}
          >
            <View {...props(args)} />
          </Specimen>
        ))}
      </div>
    ),
  };
  return result;
}

const BuiltinTool = ({ tool }: ToolProps) => <ToolBlock {...tool} />;
export function toolStories<K extends string>(
  fixture: ToolFixture,
  proposals: Record<K, Proposal<ToolProps>>,
) {
  return stories(
    proposals,
    BuiltinTool,
    ({ phase = "done" }: { phase?: Phase }) => ({
      tool: atPhase(fixture, phase),
      phase,
    }),
  );
}
export function contentStories<K extends string>(
  proposals: Record<K, Proposal<object>>,
  Default: ComponentType,
) {
  return stories(proposals, Default, () => ({}));
}

/** A call without a final result is running while live, interrupted afterwards. */
export const phaseOf = (tool: Tool): Phase =>
  tool.state?.status === "done" || tool.state?.status === "error"
    ? tool.state.status
    : tool.live
      ? "running"
      : "error";
