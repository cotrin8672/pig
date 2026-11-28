import type { Preview } from "@storybook/react-vite";
import type { CSSProperties, ReactNode } from "react";
import { createThemeTokens } from "../src/mainview/dynamic-theme";
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
  appPreview,
  themeColor,
  neutralWallpaper,
}: {
  children: ReactNode;
  windowPreview?: boolean;
  appPreview?: boolean;
  themeColor?: string;
  neutralWallpaper?: boolean;
}) {
  return (
    <div
      className="glass-stage"
      data-neutral-wallpaper={neutralWallpaper || undefined}
      style={
        themeColor
          ? (createThemeTokens(themeColor) as CSSProperties)
          : undefined
      }
    >
      <div className="glass-wallpaper" aria-hidden="true" />
      {appPreview ? (
        children
      ) : (
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
      )}
    </div>
  );
}

export default {
  parameters: {
    layout: "fullscreen",
    options: {
      storySort: {
        order: [
          "Design System",
          [
            "Screens",
            "Domain",
            [
              "Sidebar",
              ["Default", "*"],
              "ChatScreen",
              ["Default", "Running", "*"],
              "ComposerUI",
              ["Default", "Running", "*"],
            ],
            "Patterns",
            "Primitives",
            "Foundations",
          ],
          "ChatRenderer",
          "*",
        ],
      },
    },
  },
  decorators: [
    (Story, { parameters }) => (
      <GlassStage
        windowPreview={parameters.windowPreview}
        appPreview={parameters.appPreview}
        themeColor={parameters.themeColor}
        neutralWallpaper={parameters.neutralWallpaper}
      >
        {parameters.gallery ||
        parameters.windowPreview ||
        parameters.appPreview ? (
          <Story />
        ) : (
          <StoryTurn>
            <Story />
          </StoryTurn>
        )}
      </GlassStage>
    ),
  ],
} satisfies Preview;
