import type { ExtensionUIEvent } from "../shared/extension-ui";
import type { Snapshot, WireEvent } from "../shared/rpc-schema";
import type {
  RuntimeEvent,
  RuntimeViewState,
  SessionAddress,
} from "../shared/runtime-contract";
import type {
  TerminalClientCommand,
  TerminalHostEvent,
} from "../shared/terminal-ui";
import {
  addressKey,
  applyChatEvent,
  hydrateChatSnapshot,
  newerSnapshot,
  sameAddress,
} from "./chat-snapshot";
import { drafts } from "./draft-store";
import {
  alignExtensionNotices,
  appendExtensionNotice,
} from "./extension-notices";
import { selections } from "./selections";
import { showNotice, useStore } from "./store";
import { overlaySessionInfo } from "./ui-mutations";
import { addRequest, uiKey } from "./ui-request-state";

const ownershipListeners = new Set<
  (previous: SessionAddress, next: SessionAddress) => void
>();
export function subscribeOwnership(
  listener: (previous: SessionAddress, next: SessionAddress) => void,
) {
  ownershipListeners.add(listener);
  return () => {
    ownershipListeners.delete(listener);
  };
}
const retired = new Map<string, number>();
const latest = new Map<string, WireEvent>();
const terminalListeners = new Set<(event: TerminalHostEvent) => void>();
export let runtimeRevision = 0;
function retire(address: SessionAddress) {
  retired.set(
    address.sessionId,
    Math.max(address.epoch, retired.get(address.sessionId) ?? -1),
  );
  latest.delete(addressKey(address));
}
export function liveAddress(address: SessionAddress) {
  const state = useStore.getState();
  const current = state.addresses[address.sessionId];
  return (
    (!state.hostId || state.hostId === address.hostId) &&
    address.epoch > (retired.get(address.sessionId) ?? -1) &&
    (!current || address.epoch >= current.epoch)
  );
}
function register(address: SessionAddress) {
  if (!liveAddress(address)) return false;
  const previous = useStore.getState().addresses[address.sessionId];
  if (previous && !sameAddress(previous, address)) {
    latest.delete(addressKey(previous));
    useStore.setState((s) => ({
      extensionNotices: Object.fromEntries(
        Object.entries(s.extensionNotices).filter(
          ([key]) => key !== addressKey(previous),
        ),
      ),
    }));
  }
  useStore.setState((s) => ({
    hostId: address.hostId,
    addresses: { ...s.addresses, [address.sessionId]: address },
  }));
  return true;
}
function removeSurfaces(address: SessionAddress) {
  useStore.setState((s) => ({
    pendingUI: s.pendingUI.filter((request) => !sameAddress(request, address)),
    terminals: Object.fromEntries(
      Object.entries(s.terminals).filter(
        ([key]) =>
          !s.pendingUI.some((r) => sameAddress(r, address) && uiKey(r) === key),
      ),
    ),
    extensionStatuses: Object.fromEntries(
      Object.entries(s.extensionStatuses).filter(
        ([key]) => key !== addressKey(address),
      ),
    ),
    extensionNotices: Object.fromEntries(
      Object.entries(s.extensionNotices).filter(
        ([key]) => key !== addressKey(address),
      ),
    ),
    capabilities: Object.fromEntries(
      Object.entries(s.capabilities).filter(
        ([key]) => key !== addressKey(address),
      ),
    ),
  }));
}
function replace(previous: SessionAddress, next: SessionAddress) {
  if (
    sameAddress(previous, next) ||
    previous.epoch <= (retired.get(previous.sessionId) ?? -1)
  )
    return;
  retire(previous);
  drafts.transfer(previous, next);
  for (const listener of ownershipListeners) listener(previous, next);
  removeSurfaces(previous);
  useStore.setState((s) => {
    const snapshots = { ...s.snapshots };
    if (sameAddress(snapshots[previous.sessionId]?.address ?? next, previous))
      delete snapshots[previous.sessionId];
    return {
      snapshots,
      active: s.active === previous.sessionId ? next.sessionId : s.active,
    };
  });
}
export function receiveSnapshot(incoming: Snapshot) {
  if (!register(incoming.address)) return;
  incoming = hydrateChatSnapshot(incoming);
  const wire = latest.get(addressKey(incoming.address));
  const snapshot = {
    ...(wire ? applyChatEvent(incoming, wire) : incoming),
    info: overlaySessionInfo(incoming.info),
  };
  latest.delete(addressKey(incoming.address));
  useStore.setState((s) => {
    const current = s.snapshots[incoming.info.id];
    const next = newerSnapshot(current, snapshot);
    if (next === current) return {};
    const key = addressKey(next.address);
    const notices = s.extensionNotices[key];
    return {
      extensionNotices: notices
        ? {
            ...s.extensionNotices,
            [key]: alignExtensionNotices(notices, next.transcript),
          }
        : s.extensionNotices,
      snapshots: {
        ...s.snapshots,
        [incoming.info.id]: selections.overlay(next),
      },
    };
  });
}
export function receiveWire(event: WireEvent) {
  if (!liveAddress(event.address)) return;
  const key = addressKey(event.address);
  if ((latest.get(key)?.snapshotSeq ?? -1) >= event.snapshotSeq) return;
  useStore.setState((s) => {
    const snapshot = s.snapshots[event.address.sessionId];
    if (!snapshot || !sameAddress(snapshot.address, event.address)) {
      latest.set(key, event);
      return {};
    }
    latest.delete(key);
    const next = applyChatEvent(snapshot, event);
    const notices = s.extensionNotices[key];
    return {
      extensionNotices: notices
        ? {
            ...s.extensionNotices,
            [key]: alignExtensionNotices(notices, next.transcript),
          }
        : s.extensionNotices,
      snapshots: {
        ...s.snapshots,
        [event.address.sessionId]: next,
      },
    };
  });
}
export function receiveRuntime(event: RuntimeEvent) {
  runtimeRevision++;
  if (event.type === "opening") {
    if (!register(event.address)) return;
    if (event.openId)
      useStore.setState((state) => {
        const pending = state.pendingOpens[event.openId as string];
        return {
          ...(event.openId === state.openId
            ? { openingAddress: event.address }
            : {}),
          ...(pending
            ? {
                pendingOpens: {
                  ...state.pendingOpens,
                  [event.openId as string]: {
                    ...pending,
                    address: event.address,
                  },
                },
              }
            : {}),
        };
      });
    if (event.previous) replace(event.previous, event.address);
  } else if (event.type === "replaced") {
    if (!liveAddress(event.snapshot.address)) return;
    replace(event.previous, event.snapshot.address);
    receiveSnapshot(event.snapshot);
  } else if (event.type === "ready" || event.type === "snapshot")
    receiveSnapshot(event.snapshot);
  else {
    if (!liveAddress(event.address)) return;
    retire(event.address);
    drafts.retire(event.address);
    removeSurfaces(event.address);
    useStore.setState((s) => {
      const snapshots = { ...s.snapshots };
      if (
        snapshots[event.address.sessionId] &&
        sameAddress(snapshots[event.address.sessionId].address, event.address)
      ) {
        const snapshot = snapshots[event.address.sessionId];
        if (event.reason === "failed" && snapshot.ready === false)
          snapshots[event.address.sessionId] = {
            ...snapshot,
            failure: event.message,
          };
        else delete snapshots[event.address.sessionId];
      }
      return { snapshots };
    });
    if (event.reason === "failed" && event.message)
      showNotice({ level: "error", message: event.message });
  }
}
export function receiveExtension(event: ExtensionUIEvent) {
  runtimeRevision++;
  const address = event.type === "request" ? event.request : event.address;
  if (!register(address)) return;
  if (event.type === "request")
    useStore.setState((s) => ({
      pendingUI: addRequest(s.pendingUI, event.request),
    }));
  if (event.type === "requestEnd")
    useStore.setState((s) => ({
      pendingUI: s.pendingUI.filter(
        (request) => uiKey(request) !== uiKey(event.address),
      ),
      terminals: Object.fromEntries(
        Object.entries(s.terminals).filter(
          ([key]) => key !== uiKey(event.address),
        ),
      ),
    }));
  if (event.type === "draft") drafts.receive(event.address, event.draft);
  if (event.type === "status")
    useStore.setState((s) => ({
      extensionStatuses: {
        ...s.extensionStatuses,
        [addressKey(event.address)]: event.status,
      },
    }));
  if (event.type === "notify")
    useStore.setState((s) => {
      const key = addressKey(event.address);
      const snapshot = s.snapshots[event.address.sessionId];
      const transcript =
        snapshot && sameAddress(snapshot.address, event.address)
          ? snapshot.transcript
          : latest.get(key)?.transcript;
      return {
        extensionNotices: {
          ...s.extensionNotices,
          [key]: appendExtensionNotice(
            s.extensionNotices[key] ?? [],
            event,
            transcript,
          ),
        },
      };
    });
  if (event.type === "capability" && !event.supported)
    useStore.setState((s) => ({
      capabilities: {
        ...s.capabilities,
        [addressKey(event.address)]: [
          ...new Set([
            ...(s.capabilities[addressKey(event.address)] ?? []),
            `${event.api}: ${event.message}`,
          ]),
        ],
      },
    }));
}
export function receiveRuntimeState(state: RuntimeViewState, since: number) {
  // An in-flight reconnect response cannot roll back newer live publications.
  if (since !== runtimeRevision) return false;
  const old = useStore.getState();
  if (old.hostId && old.hostId !== state.hostId) {
    for (const address of Object.values(old.addresses)) drafts.retire(address);
    latest.clear();
    retired.clear();
    useStore.setState({
      snapshots: {},
      addresses: {},
      pendingUI: [],
      terminals: {},
      extensionStatuses: {},
      extensionNotices: {},
      capabilities: {},
    });
    showNotice({
      level: "warning",
      message:
        "Runtime restarted. Unconfirmed sends may have executed; drafts are retained under their previous owner.",
    });
  }
  const present = new Set(
    state.sessions.map((session) => addressKey(session.address)),
  );
  for (const [key, wire] of latest) if (!present.has(key)) retire(wire.address);
  for (const address of Object.values(useStore.getState().addresses))
    if (!present.has(addressKey(address))) {
      retire(address);
      drafts.retire(address);
      removeSurfaces(address);
    }
  useStore.setState((s) => ({
    snapshots: Object.fromEntries(
      Object.entries(s.snapshots).filter(([, snapshot]) =>
        present.has(addressKey(snapshot.address)),
      ),
    ),
    addresses: Object.fromEntries(
      state.sessions.map((session) => [
        session.address.sessionId,
        session.address,
      ]),
    ),
    pendingUI: s.pendingUI.filter(
      (request) =>
        request.kind === "terminal" &&
        state.pendingUI.some((pending) => uiKey(pending) === uiKey(request)),
    ),
    terminals: Object.fromEntries(
      Object.entries(s.terminals).filter(([key]) =>
        state.pendingUI.some((request) => uiKey(request) === key),
      ),
    ),
    extensionStatuses: {},
    extensionNotices: Object.fromEntries(
      Object.entries(s.extensionNotices).filter(([key]) => present.has(key)),
    ),
    capabilities: Object.fromEntries(
      Object.entries(s.capabilities).filter(([key]) => present.has(key)),
    ),
  }));
  useStore.setState({ hostId: state.hostId });
  for (const session of state.sessions) {
    register(session.address);
    if (session.snapshot) receiveSnapshot(session.snapshot);
  }
  for (const item of state.drafts)
    if (liveAddress(item.address)) drafts.receive(item.address, item.draft);
  for (const item of state.statuses)
    receiveExtension({ type: "status", ...item });
  for (const request of state.pendingUI) {
    // A disconnected terminal has no replay/resume protocol.
    if (request.kind !== "terminal")
      receiveExtension({ type: "request", request });
  }
  return true;
}
export function receiveTerminal(event: TerminalHostEvent) {
  // Terminal transport may omit hostId. Bind it only to an exact already registered
  // Broker owner, never the active tab or a guessed current session.
  const matches = useStore
    .getState()
    .pendingUI.filter(
      (request) =>
        request.kind === "terminal" &&
        request.sessionId === event.sessionId &&
        request.epoch === event.epoch &&
        request.uiId === event.uiId &&
        liveAddress(request),
    );
  if (matches.length !== 1) return;
  const owner = matches[0];
  if ("hostId" in event && event.hostId !== owner.hostId) return;
  if (event.type === "open")
    useStore.setState((s) => ({
      terminals: { ...s.terminals, [uiKey(owner)]: event },
    }));
  for (const listener of terminalListeners) listener(event);
}
export function subscribeTerminal(
  listener: (event: TerminalHostEvent) => void,
) {
  terminalListeners.add(listener);
  return () => {
    terminalListeners.delete(listener);
  };
}
export function ownedTerminalCommand(
  owner: SessionAddress & { uiId: string },
  command: TerminalClientCommand,
): TerminalClientCommand & SessionAddress {
  if (
    !liveAddress(owner) ||
    command.sessionId !== owner.sessionId ||
    command.epoch !== owner.epoch ||
    command.uiId !== owner.uiId
  )
    throw new Error("Stale terminal UI owner");
  return { ...command, ...owner };
}
