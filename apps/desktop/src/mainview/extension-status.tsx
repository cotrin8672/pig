import type { ExtensionStatus } from "../shared/extension-ui";

export function workingLabel(
  status: ExtensionStatus | undefined,
  fallback: string,
) {
  return [status?.workingSymbol, status?.workingMessage ?? fallback]
    .filter(Boolean)
    .join(" ");
}
