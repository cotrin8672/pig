import { create } from "zustand";
import type { TerminalUIEvent } from "../shared/terminal-ui";

type Request = Extract<TerminalUIEvent, { type: "open" }>;
export const useTerminalUI = create<{ requests: Request[] }>(() => ({
  requests: [],
}));
const outputs = new Map<string, (data: string) => void>();

export function receiveTerminalUI(event: TerminalUIEvent) {
  if (event.type === "data") {
    outputs.get(event.id)?.(event.data);
  } else if (event.type === "open") {
    useTerminalUI.setState((s) =>
      s.requests.some((r) => r.id === event.id)
        ? {}
        : { requests: [...s.requests, event] },
    );
  } else {
    outputs.delete(event.id);
    useTerminalUI.setState((s) => ({
      requests: s.requests.filter((r) => r.id !== event.id),
    }));
  }
}

export function subscribeTerminalOutput(
  id: string,
  write: (data: string) => void,
) {
  outputs.set(id, write);
  return () => {
    if (outputs.get(id) === write) outputs.delete(id);
  };
}
