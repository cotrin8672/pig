import { useLayoutEffect } from "react";
import { applyThemeTokens } from "./dynamic-theme";
import { useStore } from "./store";

/** CSS updates recolour existing DOM without re-tokenizing code or remounting chats. */
export function DynamicTheme() {
  const seed = useStore((state) => state.appearance.themeColor);
  useLayoutEffect(
    () => applyThemeTokens(document.documentElement.style, seed),
    [seed],
  );
  return null;
}
