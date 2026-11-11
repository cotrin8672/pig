import { configureExtensionUI } from "./extension-ui";
import { initTheme, Theme } from "./sdk";

let initialized = false;
/** One process-wide, truecolor desktop theme; never mutate TUI globals per session. */
export function initializeRuntimeTheme() {
  if (initialized) return;
  initTheme("dark", false);
  configureExtensionUI(
    new Theme(
      {
        accent: "#88c0d0",
        border: "#4c566a",
        borderAccent: "#88c0d0",
        borderMuted: "#3b4252",
        success: "#a3be8c",
        error: "#bf616a",
        warning: "#ebcb8b",
        muted: "#7b88a1",
        dim: "#616e88",
        text: "#eceff4",
        thinkingText: "#aab4c4",
        userMessageText: "#eceff4",
        customMessageText: "#e5e9f0",
        customMessageLabel: "#b48ead",
        toolTitle: "#88c0d0",
        toolOutput: "#e5e9f0",
        mdHeading: "#81a1c1",
        mdLink: "#88c0d0",
        mdLinkUrl: "#7b88a1",
        mdCode: "#a3be8c",
        mdCodeBlock: "#e5e9f0",
        mdCodeBlockBorder: "#4c566a",
        mdQuote: "#aab4c4",
        mdQuoteBorder: "#4c566a",
        mdHr: "#4c566a",
        mdListBullet: "#88c0d0",
        toolDiffAdded: "#a3be8c",
        toolDiffRemoved: "#bf616a",
        toolDiffContext: "#aab4c4",
        syntaxComment: "#616e88",
        syntaxKeyword: "#81a1c1",
        syntaxFunction: "#88c0d0",
        syntaxVariable: "#d8dee9",
        syntaxString: "#a3be8c",
        syntaxNumber: "#b48ead",
        syntaxType: "#8fbcbb",
        syntaxOperator: "#81a1c1",
        syntaxPunctuation: "#eceff4",
        thinkingOff: "#4c566a",
        thinkingMinimal: "#616e88",
        thinkingLow: "#81a1c1",
        thinkingMedium: "#88c0d0",
        thinkingHigh: "#b48ead",
        thinkingXhigh: "#ebcb8b",
        bashMode: "#a3be8c",
      },
      {
        selectedBg: "#434c5e",
        userMessageBg: "#2e3440",
        customMessageBg: "#3b4252",
        toolPendingBg: "#3b4252",
        toolSuccessBg: "#2e3a34",
        toolErrorBg: "#4c343a",
      },
      "truecolor",
      { name: "pig-desktop", appearance: "dark" },
    ),
  );
  initialized = true;
}
