import { Electroview } from "electrobun/view";
import type { RPCSchema } from "../shared/rpc-schema";
import { reduceTranscript } from "../shared/transcript";
import { receivePackageOp, showError, useStore } from "./store";

export const rpc = Electroview.defineRPC<RPCSchema>({
  maxRequestTime: 600_000,
  handlers: {
    requests: {},
    messages: {
      packageOp: receivePackageOp,
      installed: (installed) => useStore.setState({ installed }),
      appearance: (appearance) => useStore.setState({ appearance }),
      windowState: ({ maximized }) => useStore.setState({ maximized }),
      appearanceError: ({ message }) => showError(message),
      projects: (projects) => {
        useStore.setState((s) => ({ bootstrap: { ...s.bootstrap, projects } }));
        void refresh().catch(showError);
      },
      error: ({ message }) => showError(message),
      agentEvent: ({ sessionId, event }) => {
        useStore.setState((s) => {
          const snapshot = s.snapshots[sessionId];
          if (!snapshot) return {};
          return {
            snapshots: {
              ...s.snapshots,
              [sessionId]: {
                ...snapshot,
                transcript: reduceTranscript(snapshot.transcript, event),
              },
            },
          };
        });
        if (
          event.type === "agent_settled" ||
          event.type === "session_info_changed"
        )
          void refreshSessions().catch(showError);
      },
      loginFrame: (frame) => {
        const login = useStore.getState().login;
        if (!login || login.loginId !== frame.loginId) return;
        if (frame.kind === "event")
          useStore.setState({
            login: {
              ...login,
              event: frame.event,
              ...(frame.event.type === "auth_url"
                ? { authUrl: frame.event }
                : {}),
              ...(frame.event.type === "device_code"
                ? { deviceCode: frame.event }
                : {}),
            },
          });
        if (frame.kind === "prompt")
          useStore.setState({ login: { ...login, prompt: frame.prompt } });
        if (frame.kind === "promptEnd")
          useStore.setState({ login: { ...login, prompt: undefined } });
        if (frame.kind === "error")
          useStore.setState({
            login: { ...login, error: frame.message, prompt: undefined },
          });
        if (frame.kind === "success" || frame.kind === "cancelled") {
          useStore.setState({ login: undefined });
          void refresh().catch(showError);
        }
      },
    },
  },
});
new Electroview({ rpc });
export async function refreshSessions() {
  const entries = await Promise.all(
    useStore
      .getState()
      .bootstrap.projects.map(
        async (cwd) => [cwd, await rpc.request.listSessions({ cwd })] as const,
      ),
  );
  useStore.setState({ sessions: Object.fromEntries(entries) });
}
export async function refresh() {
  useStore.setState({ bootstrap: await rpc.request.bootstrap() });
  try {
    useStore.setState({ appearance: await rpc.request.appearance() });
  } catch (error) {
    showError(error);
  }
  await refreshSessions();
}
export async function openChat(cwd: string, path?: string, id?: string) {
  if (useStore.getState().opening) return;
  useStore.setState({ opening: true });
  try {
    const snapshot = await rpc.request.openSession({ cwd, path, id });
    useStore.setState((s) => ({
      active: snapshot.info.id,
      page: "chat",
      snapshots: { ...s.snapshots, [snapshot.info.id]: snapshot },
    }));
    await refreshSessions();
  } catch (error) {
    showError(error);
  } finally {
    useStore.setState({ opening: false });
  }
}
