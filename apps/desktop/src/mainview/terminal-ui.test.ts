import { expect, test } from "bun:test";
import {
  receiveTerminalUI,
  subscribeTerminalOutput,
  useTerminalUI,
} from "./terminal-ui";

test("terminal requests queue globally and stale writes/close are isolated by UI id", () => {
  useTerminalUI.setState({ requests: [] });
  receiveTerminalUI({ type: "open", id: "a", sessionId: "session-a" });
  receiveTerminalUI({ type: "open", id: "b", sessionId: "session-b" });
  receiveTerminalUI({ type: "open", id: "a", sessionId: "session-a" });
  expect(useTerminalUI.getState().requests.map((r) => r.id)).toEqual([
    "a",
    "b",
  ]);
  const output: string[] = [];
  const unsubscribe = subscribeTerminalOutput("a", (data) => output.push(data));
  receiveTerminalUI({ type: "data", id: "a", data: "frame" });
  receiveTerminalUI({ type: "data", id: "unknown", data: "stale" });
  receiveTerminalUI({ type: "close", id: "a" });
  receiveTerminalUI({ type: "data", id: "a", data: "late" });
  expect(output).toEqual(["frame"]);
  expect(useTerminalUI.getState().requests[0].sessionId).toBe("session-b");
  unsubscribe();
  receiveTerminalUI({ type: "close", id: "b" });
  expect(useTerminalUI.getState().requests).toEqual([]);
});
