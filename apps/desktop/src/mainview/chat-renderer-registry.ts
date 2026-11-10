import type {
  ChatRenderData,
  ChatRenderer,
  ChatRendererComponent,
  ChatRenderKind,
} from "@pig/chat-renderers";

export interface RendererState {
  generation: number;
  renderers: readonly ChatRenderer[];
  file: string;
  error?: string;
  diagnostics: string[];
}
let state: RendererState = {
  generation: 0,
  renderers: [],
  file: "",
  diagnostics: [],
};
const listeners = new Set<() => void>();
export const rendererSnapshot = () => state;
export function subscribeRenderers(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(next: RendererState) {
  state = next;
  for (const listener of listeners) listener();
}
export function rendererLoadError(file: string, error: unknown) {
  publish({ ...state, file, error: String(error) });
}
export function reportRendererError(
  id: string,
  error: unknown,
  generation = state.generation,
) {
  const message = `${id}: ${String(error)}`;
  // Predicates run during React render; diagnostics publish outside that render.
  queueMicrotask(() => {
    if (generation !== state.generation || state.diagnostics.includes(message))
      return;
    publish({
      ...state,
      diagnostics: [...state.diagnostics.slice(-31), message],
    });
  });
}
export function installChatRenderers(value: unknown, file = "") {
  if (!Array.isArray(value) || value.length > 128)
    throw new Error("Expected at most 128 chat renderers");
  const ids = new Set<string>();
  const renderers: ChatRenderer[] = [];
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.id !== "string" ||
      !entry.id.trim() ||
      entry.id.length > 128 ||
      ids.has(entry.id)
    )
      throw new Error("Chat renderer IDs must be nonempty and unique");
    if (
      !["markdown", "image", "tool", "custom", "thinking"].includes(entry.kind)
    )
      throw new Error(`Unknown renderer kind: ${entry.kind}`);
    const component = entry.component;
    const exotic =
      component &&
      typeof component === "object" &&
      [Symbol.for("react.memo"), Symbol.for("react.forward_ref")].includes(
        component.$$typeof,
      );
    if (typeof component !== "function" && !exotic)
      throw new Error(`${entry.id}: component must be a React component`);
    if (entry.match !== undefined && typeof entry.match !== "function")
      throw new Error(`${entry.id}: match must be a function`);
    ids.add(entry.id);
    renderers.push({
      id: entry.id,
      kind: entry.kind,
      component,
      match: entry.match,
    } as ChatRenderer);
  }
  publish({
    generation: state.generation + 1,
    renderers,
    file,
    diagnostics: [],
  });
}
export function selectChatRenderer<K extends ChatRenderKind>(
  kind: K,
  data: ChatRenderData[K],
  snapshot = state,
) {
  for (const entry of snapshot.renderers) {
    if (entry.kind !== kind) continue;
    // kind is the discriminator for both the predicate and the component props.
    const renderer = entry as {
      id: string;
      match?: (data: ChatRenderData[K]) => boolean;
      component: ChatRendererComponent<K>;
    };
    try {
      if (!renderer.match || renderer.match(data)) return renderer;
    } catch (error) {
      reportRendererError(entry.id, error, snapshot.generation);
    }
  }
}
