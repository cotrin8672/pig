import type { DesktopState } from "../shared/desktop-state";
import type { SessionInfo } from "../shared/rpc-schema";

/**
 * The last sidebar, shown at launch until bootstrap answers. Display only:
 * every action still goes through the host, which validates membership.
 */
export type SidebarCache = {
  generalCwd: string;
  projects: string[];
  desktop: Pick<DesktopState, "sessions" | "projects">;
  sessions: Record<string, SessionInfo[]>;
};
export const SIDEBAR_CACHE_KEY = "pig.sidebar-cache";

export function parseSidebarCache(
  raw: string | null,
): SidebarCache | undefined {
  if (!raw) return;
  try {
    const value = JSON.parse(raw);
    if (
      typeof value?.generalCwd !== "string" ||
      !Array.isArray(value.projects) ||
      !value.projects.every((cwd: unknown) => typeof cwd === "string") ||
      typeof value.desktop?.sessions !== "object" ||
      typeof value.sessions !== "object"
    )
      return;
    const sessions: Record<string, SessionInfo[]> = {};
    for (const [cwd, list] of Object.entries(value.sessions)) {
      if (!Array.isArray(list)) return;
      sessions[cwd] = list.filter(
        (item): item is SessionInfo =>
          typeof item?.id === "string" &&
          typeof item.title === "string" &&
          typeof item.modified === "number" &&
          item.cwd === cwd,
      );
    }
    return {
      generalCwd: value.generalCwd,
      projects: value.projects,
      desktop: {
        sessions: value.desktop.sessions ?? {},
        projects: value.desktop.projects ?? {},
      },
      sessions,
    };
  } catch {
    return;
  }
}

export function loadSidebarCache() {
  try {
    if (typeof localStorage === "undefined") return;
    return parseSidebarCache(localStorage.getItem(SIDEBAR_CACHE_KEY));
  } catch {
    return;
  }
}

export function saveSidebarCache(cache: SidebarCache) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SIDEBAR_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn("Cannot save sidebar cache:", error);
  }
}
