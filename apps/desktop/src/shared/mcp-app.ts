/** Host-only reference. HTML, credentials and MCP result metadata never go in the transcript. */
export type McpAppRef = {
  version: 1;
  id: string;
  title?: string;
};

export const MCP_APP_MAX_BYTES = 1024 * 1024;

/** Raw HTML is marked and must go only to the isolated Tauri widget document. */
export type McpAppPreviewResult = { html: string; interactive?: true } | null;

export function mcpAppRef(details: unknown): McpAppRef | undefined {
  if (!details || typeof details !== "object" || !("mcpApp" in details))
    return undefined;
  const ref = details.mcpApp;
  if (
    !ref ||
    typeof ref !== "object" ||
    !("version" in ref) ||
    ref.version !== 1 ||
    !("id" in ref) ||
    typeof ref.id !== "string" ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(ref.id)
  )
    return undefined;
  return {
    version: 1,
    id: ref.id,
    ...("title" in ref && typeof ref.title === "string"
      ? { title: ref.title.slice(0, 128) }
      : {}),
  };
}
