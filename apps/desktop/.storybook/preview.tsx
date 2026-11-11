import type { Preview } from "@storybook/react-vite";
import { StoryTurn } from "../src/stories/StoryTurn";
import "katex/dist/katex.min.css";
import "../src/mainview/styles.css";

export default {
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story, { parameters }) => (
      <div
        style={{
          height: "100vh",
          overflow: "auto",
          background: "var(--ds-bg-primary)",
          padding: "24px",
        }}
      >
        <div className="transcript">
          {parameters.gallery ? (
            <Story />
          ) : (
            <StoryTurn role={parameters.role}>
              <Story />
            </StoryTurn>
          )}
        </div>
      </div>
    ),
  ],
} satisfies Preview;
