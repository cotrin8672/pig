import { LoaderCircle } from "lucide-react";
import { lazy, type ReactNode, Suspense, useLayoutEffect } from "react";
import { applyThemeTokens } from "../../mainview/dynamic-theme";
import { useStore } from "../../mainview/store";
import type { PreviewArgs } from "./fixtures";
import "./preview.css";

// Story modules share this entry, but must not eagerly load each other's UI.
export const DesktopPreview = lazy(() => import("./DesktopPreview"));
export const ComposerUIPreview = lazy(() => import("./ComposerUIPreview"));
export const ChatScreenPreview = lazy(() => import("./ChatScreenPreview"));
export const SidebarPreview = lazy(() => import("./SidebarPreview"));
export const ModelPickerPreview = lazy(() => import("./ModelPickerPreview"));
export const NotificationPreview = lazy(() => import("./NotificationPreview"));
export const ActivityPreview = lazy(() => import("./ActivityPreview"));

export function PreviewTheme({
  args,
  children,
}: {
  args: PreviewArgs;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    useStore.setState((state) => ({
      appearance: { ...state.appearance, themeColor: args.themeColor },
      settings: { ...state.settings, language: args.language },
    }));
    applyThemeTokens(document.documentElement.style, args.themeColor);
    document.documentElement.lang = args.language;
  }, [args.themeColor, args.language]);
  return (
    <Suspense
      fallback={
        <div
          className="current-ui-loading"
          role="status"
          aria-label="プレビューを読み込み中"
        >
          <LoaderCircle size={20} className="spinner" aria-hidden="true" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
