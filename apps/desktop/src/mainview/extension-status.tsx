import type { ExtensionStatus } from "../shared/extension-ui";
import type { SessionAddress } from "../shared/runtime-contract";
import { addressKey } from "./chat-snapshot";
import { useStore } from "./store";

export function ExtensionWidgets({ address }: { address: SessionAddress }) {
  const status = useStore((s) => s.extensionStatuses[addressKey(address)]);
  return (
    <div className="extension-widgets aboveEditor">
      {status?.widgets
        .filter((widget) => widget.placement === "aboveEditor")
        .map((widget) => (
          <pre key={widget.key} title={widget.key}>
            {widget.lines.join("\n")}
          </pre>
        ))}
    </div>
  );
}
export function workingLabel(
  status: ExtensionStatus | undefined,
  fallback: string,
) {
  return [status?.workingSymbol, status?.workingMessage ?? fallback]
    .filter(Boolean)
    .join(" ");
}
