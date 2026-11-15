/** Parses the Codex apply_patch envelope (pi-codex-tools) for display. */

export type PatchFile = {
  kind: "add" | "update" | "delete";
  path: string;
  moveTo?: string;
  /** Hunks as unified-diff text; for added files, the new content. */
  hunks: string[];
  added: number;
  removed: number;
};

/** Tolerates a partial patch, since the argument streams in while the call runs. */
export function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let file: PatchFile | undefined;
  let hunk: string[] | undefined;
  const flush = () => {
    if (file && hunk?.length) file.hunks.push(hunk.join("\n"));
    hunk = undefined;
  };
  for (const row of patch.replace(/\r\n/g, "\n").split("\n")) {
    const head = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(row);
    if (head) {
      flush();
      file = {
        kind: head[1].toLowerCase() as PatchFile["kind"],
        path: head[2].trim(),
        hunks: [],
        added: 0,
        removed: 0,
      };
      files.push(file);
      continue;
    }
    if (!file) continue;
    const move = /^\*\*\* Move to: (.+)$/.exec(row);
    if (move) {
      file.moveTo = move[1].trim();
      continue;
    }
    if (row.startsWith("@@")) {
      flush();
      continue;
    }
    if (row.startsWith("***")) continue;
    if (row[0] === "+") file.added++;
    else if (row[0] === "-") file.removed++;
    else if (file.kind === "add") continue;
    // Added files hold plain content; updates keep the diff markers.
    hunk ??= [];
    hunk.push(file.kind === "add" ? row.slice(1) : row);
  }
  flush();
  return files;
}
