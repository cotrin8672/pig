import type { ExtensionStatus } from "../shared/extension-ui";
import type { SessionAddress } from "../shared/runtime-contract";
import { addressKey } from "./chat-snapshot";
import { rpc } from "./rpc";
import { showError, showNotice, useStore } from "./store";

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
export function ExtensionStatusBar({ address }: { address: SessionAddress }) {
  const status = useStore((s) => s.extensionStatuses[addressKey(address)]);
  const capabilities = useStore((s) => s.capabilities[addressKey(address)]);
  return (
    <>
      <div className="extension-status" role="status">
        {status?.statuses.map((item) => (
          <span key={item.key} title={item.key}>
            {item.text}
          </span>
        ))}
      </div>
      {!!capabilities?.length && (
        <details className="extension-capabilities">
          <summary>Extension limitations / omitted resources</summary>
          <ul>
            {capabilities.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              void rpc.request.reloadSession(address).then(
                (result) =>
                  showNotice({
                    level: "info",
                    message:
                      result.state === "pending"
                        ? "Reload pending — stop work and close extension UI first."
                        : "Extensions reloaded.",
                  }),
                showError,
              );
            }}
          >
            Reload resources (project trust may be requested)
          </button>
        </details>
      )}
    </>
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
