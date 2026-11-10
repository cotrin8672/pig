import type { ExtensionStatus } from "../shared/extension-ui";
import type { SessionAddress } from "../shared/runtime-contract";
import { addressKey } from "./chat-snapshot";
import { useStore } from "./store";

export function ExtensionWidgets({
  address,
  placement,
}: {
  address: SessionAddress;
  placement: "aboveEditor" | "belowEditor";
}) {
  const status = useStore((s) => s.extensionStatuses[addressKey(address)]);
  return (
    <div className={`extension-widgets ${placement}`}>
      {status?.widgets
        .filter((widget) => widget.placement === placement)
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
