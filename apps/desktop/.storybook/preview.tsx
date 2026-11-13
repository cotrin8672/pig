import type { Preview } from "@storybook/react-vite";
import type { CSSProperties, ReactNode } from "react";
import { StoryTurn } from "../src/stories/StoryTurn";
import "katex/dist/katex.min.css";
import "../src/stories/glass-stage.css";
import "../src/mainview/styles.css";

/**
 * Every story runs inside the real window shell over a wallpaper, so glass and
 * translucent surfaces are judged against the acrylic they ship on.
 */
function GlassStage({
  children,
  windowPreview,
}: {
  children: ReactNode;
  windowPreview?: boolean;
}) {
  return (
    <div className="glass-stage">
      <div className="glass-wallpaper" aria-hidden="true" />
      <div
        className="app-shell glass-shell"
        style={{ "--window-opacity": 0.78 } as CSSProperties}
      >
        {windowPreview ? (
          children
        ) : (
          <div className="glass-scroll">
            <div className="transcript">{children}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default {
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story, { parameters }) => (
      <GlassStage windowPreview={parameters.windowPreview}>
        {parameters.gallery || parameters.windowPreview ? (
          <Story />
        ) : (
          <StoryTurn role={parameters.role}>
            <Story />
          </StoryTurn>
        )}
      </GlassStage>
    ),
  ],
} satisfies Preview;
