import type { ComponentType } from "react";
import { ToolBlock } from "../mainview/ToolBlock";
import {
  ContentDesign,
  type ContentKind,
  contentDesignNames,
} from "./ContentDesigns";
import {
  type ProposalPhase,
  type ProposalTool,
  type ProposalVariant,
  ToolDesign,
  toolDesignNames,
} from "./ToolDesigns";
import "./design-proposals.css";

const variants: ProposalVariant[] = [0, 1, 2];
export const toolControls = {
  args: { phase: "done" as ProposalPhase },
  argTypes: {
    phase: {
      control: "inline-radio" as const,
      options: ["done", "running", "error"],
    },
  },
};
export function toolStories(fixture: { args?: ProposalTool }) {
  const tool = fixture.args;
  if (!tool) throw new Error("Tool proposal requires fixture args");
  const names = toolDesignNames[tool.call.name];
  if (!names) throw new Error(`No proposals for ${tool.call.name}`);
  const DefaultPreview = ({ phase = "done" }: { phase?: ProposalPhase }) => (
    <ToolBlock
      {...tool}
      live={phase === "running"}
      state={
        phase === "done"
          ? tool.state
          : phase === "running"
            ? undefined
            : {
                status: "error",
                result: {
                  content: [
                    {
                      type: "text",
                      text: "処理に失敗しました。入力を確認してください。",
                    },
                  ],
                },
              }
      }
    />
  );
  const story = (variant: ProposalVariant) => ({
    name: names[variant],
    render: ({ phase = "done" }: { phase?: ProposalPhase }) => (
      <div className="ux-design">
        <ToolDesign tool={tool} variant={variant} phase={phase} />
      </div>
    ),
  });
  return {
    Default: { render: DefaultPreview },
    Ledger: story(0),
    Sheet: story(1),
    Receipt: story(2),
    Compare: {
      name: "Compare all",
      render: ({ phase = "done" }: { phase?: ProposalPhase }) => (
        <div className="ux-comparison">
          <section>
            <h3>
              <span>00</span>Default
            </h3>
            <DefaultPreview phase={phase} />
          </section>
          {variants.map((variant) => (
            <section key={variant}>
              <h3>
                <span>0{variant + 1}</span>
                {names[variant]}
              </h3>
              <div className="ux-design">
                <ToolDesign tool={tool} variant={variant} phase={phase} />
              </div>
            </section>
          ))}
        </div>
      ),
    },
  };
}
export function contentStories(kind: ContentKind, Default: ComponentType) {
  const names = contentDesignNames[kind];
  const story = (variant: ProposalVariant) => ({
    name: names[variant],
    render: () => (
      <div className="ux-design">
        <ContentDesign kind={kind} variant={variant} />
      </div>
    ),
  });
  return {
    Default: { render: () => <Default /> },
    Rail: story(0),
    Sheet: story(1),
    Folded: story(2),
    Compare: {
      name: "Compare all",
      render: () => (
        <div className="ux-comparison">
          <section>
            <h3>
              <span>00</span>Default
            </h3>
            <Default />
          </section>
          {variants.map((variant) => (
            <section key={variant}>
              <h3>
                <span>0{variant + 1}</span>
                {names[variant]}
              </h3>
              <div className="ux-design">
                <ContentDesign kind={kind} variant={variant} />
              </div>
            </section>
          ))}
        </div>
      ),
    },
  };
}
