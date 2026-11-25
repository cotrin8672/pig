import { invoke } from "@tauri-apps/api/core";
import type { ThemedToken } from "shiki/core";
import { syntaxThemeColor } from "./syntax-theme";

const colors = [
  undefined,
  "#81a1c1",
  "#88c0d0",
  "#8fbcbb",
  "#a3be8c",
  "#b48ead",
  "#616e88",
  "#ebcb8b",
].map(syntaxThemeColor);

export async function highlightNative(text: string) {
  const data = new DataView(
    await invoke<ArrayBuffer>("pig_highlight_ts", { text }),
  );
  const lines: ThemedToken[][] = [[]];
  let start = 0;
  for (let i = 0; i < data.byteLength; i += 5) {
    const end = start + data.getUint32(i, true);
    const color = colors[data.getUint8(i + 4)];
    const parts = text.slice(start, end).split("\n");
    for (const [index, content] of parts.entries()) {
      if (index) {
        lines.push([]);
        start++;
      }
      if (content)
        lines[lines.length - 1].push({ content, offset: start, color });
      start += content.length;
    }
  }
  if (start !== text.length) throw new Error("Incomplete native syntax result");
  return lines;
}
