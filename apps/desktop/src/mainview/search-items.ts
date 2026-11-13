import { fuzzyMatch, termRanges } from "../shared/fuzzy";
import { en } from "../shared/i18n";
import { type ActionId, actionIds, resolveBindings } from "../shared/keymap";
import { type ProjectFlags, projectLabel } from "../shared/projects";
import type { ConversationHit, SessionInfo } from "../shared/rpc-schema";
import {
  actionLabels,
  bilingual,
  settingsCategories,
  settingTargets,
} from "./settings-search";
import type { SettingsCategory } from "./store";

export type PaletteKind =
  | "chat"
  | "project"
  | "page"
  | "action"
  | "setting"
  | "message";
export type PaletteTarget =
  | { type: "chat"; cwd: string; id?: string }
  | { type: "page"; page: "settings" | "providers" | "extensions" }
  | { type: "action"; action: ActionId }
  | { type: "setting"; category: SettingsCategory; setting?: string }
  | { type: "message"; cwd: string; sessionId: string; entryId: string };
export interface PaletteItem {
  key: string;
  kind: PaletteKind;
  title: string;
  detail?: string;
  /** Matched with a lower weight and without highlights, e.g. the other language. */
  alt?: string;
  shortcut?: string | null;
  modified?: number;
  target: PaletteTarget;
}
export interface RankedItem extends PaletteItem {
  positions: number[];
}

export interface PaletteSources {
  sessions: Record<string, SessionInfo[]>;
  deleting: Record<string, true>;
  generalCwd: string;
  projects: string[];
  projectFlags?: Record<string, ProjectFlags>;
  keybindings: Parameters<typeof resolveBindings>[0];
}

export function paletteItems(t: typeof en, s: PaletteSources): PaletteItem[] {
  const place = (cwd: string) =>
    cwd === s.generalCwd ? t.Chats : projectLabel(cwd, s.projectFlags?.[cwd]);
  const bindings = resolveBindings(s.keybindings);
  const items: PaletteItem[] = [];
  for (const [cwd, sessions] of Object.entries(s.sessions))
    for (const session of sessions)
      if (!s.deleting[session.id])
        items.push({
          key: `chat:${session.id}`,
          kind: "chat",
          title: session.title,
          detail: place(cwd),
          modified: session.modified,
          target: { type: "chat", cwd, id: session.id },
        });
  if (s.generalCwd)
    items.push({
      key: "new-chat",
      kind: "project",
      title: t["New chat"],
      alt: bilingual("New chat", en),
      target: { type: "chat", cwd: s.generalCwd },
    });
  for (const cwd of s.projects)
    if (!s.projectFlags?.[cwd]?.archived)
      items.push({
        key: `project:${cwd}`,
        kind: "project",
        title: t.newChatIn(place(cwd)),
        alt: cwd,
        target: { type: "chat", cwd },
      });
  for (const [page, label] of [
    ["settings", "Settings"],
    ["providers", "Providers"],
    ["extensions", "Extensions"],
  ] as const)
    items.push({
      key: `page:${page}`,
      kind: "page",
      title: t[label],
      alt: bilingual(label, en),
      target: { type: "page", page },
    });
  for (const action of actionIds)
    if (!action.startsWith("composer.") && action !== "search.open")
      items.push({
        key: `action:${action}`,
        kind: "action",
        title: t[actionLabels[action]],
        alt: bilingual(actionLabels[action], en),
        shortcut: bindings[action],
        target: { type: "action", action },
      });
  for (const category of settingsCategories)
    items.push({
      key: `settings:${category.id}`,
      kind: "setting",
      title: t[category.label],
      detail: t.Settings,
      alt: bilingual(category.label, en),
      target: { type: "setting", category: category.id },
    });
  for (const setting of settingTargets) {
    const category = settingsCategories.find((c) => c.id === setting.category);
    items.push({
      key: `setting:${setting.id}`,
      kind: "setting",
      title: t[setting.label],
      detail: category && `${t.Settings} › ${t[category.label]}`,
      alt: bilingual(setting.label, en),
      target: {
        type: "setting",
        category: setting.category,
        setting: setting.id,
      },
    });
  }
  return items;
}

const RECENT = 20;
const LIMIT = 50;

export function rankItems(items: PaletteItem[], query: string): RankedItem[] {
  if (!query.trim())
    return items
      .filter((item) => item.kind === "chat")
      .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))
      .slice(0, RECENT)
      .map((item) => ({ ...item, positions: [] }));
  const scored: { item: RankedItem; score: number }[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, item.title);
    if (match) {
      scored.push({
        item: { ...item, positions: match.positions },
        score: match.score,
      });
      continue;
    }
    const alt = item.alt ? fuzzyMatch(query, item.alt) : null;
    if (alt)
      scored.push({ item: { ...item, positions: [] }, score: alt.score * 0.8 });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score || (b.item.modified ?? 0) - (a.item.modified ?? 0),
    )
    .slice(0, LIMIT)
    .map(({ item }) => item);
}

export function messageItems(
  hits: ConversationHit[],
  terms: string[],
  sessions: Record<string, SessionInfo[]>,
): RankedItem[] {
  const titles = new Map(
    Object.values(sessions)
      .flat()
      .map((session) => [session.id, session.title]),
  );
  return hits.flatMap((hit) => {
    const title = titles.get(hit.sessionId);
    // Only chats listed in the sidebar can be opened.
    if (title === undefined) return [];
    return [
      {
        key: `message:${hit.sessionId}:${hit.entryId}`,
        kind: "message" as const,
        title: hit.snippet,
        detail: title,
        modified: hit.timestamp,
        positions: termRanges(hit.snippet, terms),
        target: {
          type: "message" as const,
          cwd: hit.cwd,
          sessionId: hit.sessionId,
          entryId: hit.entryId,
        },
      },
    ];
  });
}
