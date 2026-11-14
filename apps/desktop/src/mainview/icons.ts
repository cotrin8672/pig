import { createLucideIcon } from "lucide-react";

/** Folder with a plus badge in the bottom-right corner (Lucide style). */
export const FolderPlusCorner = createLucideIcon("FolderPlusCorner", [
  [
    "path",
    {
      d: "M11 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4",
      key: "folder",
    },
  ],
  ["path", { d: "M18 14v6", key: "plus-v" }],
  ["path", { d: "M15 17h6", key: "plus-h" }],
]);
