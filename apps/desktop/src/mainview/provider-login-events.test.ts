import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Bootstrap, LoginFrame } from "../shared/rpc-schema";

if (process.env.PIG_ACCOUNT_EVENTS_CHILD !== "1") {
  test("account login events in an isolated renderer", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_ACCOUNT_EVENTS_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, out + error).toBe(0);
  });
} else {
  const { useStore } = await import("./store");
  let receive!: (frame: LoginFrame) => void;
  let bootstrap = Promise.withResolvers<Bootstrap>();
  let refreshes = 0;
  mock.module("electrobun/view", () => ({
    Electroview: class {
      constructor(readonly options: unknown) {}
      static defineRPC(options: {
        handlers: { messages: { loginFrame: typeof receive } };
      }) {
        receive = options.handlers.messages.loginFrame;
        return {
          send: {},
          request: {
            bootstrap: () => {
              refreshes++;
              return bootstrap.promise;
            },
            appearance: async () => useStore.getState().appearance,
            settings: async () => useStore.getState().settings,
          },
        };
      }
    },
  }));
  await import("./rpc");
  const provider = {
    id: "openai-codex",
    name: "OpenAI Codex",
    oauth: { subscription: true },
    apiKey: false,
    configured: false,
    stored: false,
    extension: false,
  };
  const state = { ...useStore.getState().bootstrap, providers: [provider] };

  test("a new account does not mark standard pi auth connected and selects the committed account id", async () => {
    useStore.setState({
      bootstrap: state,
      login: {
        provider: provider.id,
        method: "oauth",
        loginId: "add",
        addAccount: true,
      },
    });
    receive({
      provider: provider.id,
      loginId: "add",
      accountId: "work",
      kind: "success",
    });
    expect(useStore.getState().login).toBeUndefined();
    expect(useStore.getState().bootstrap.providers[0]?.configured).toBe(false);
    expect(useStore.getState().providerSelection).toEqual({
      provider: provider.id,
      accountId: "work",
    });
    bootstrap.resolve({
      ...state,
      providers: [
        {
          ...provider,
          accounts: [
            {
              id: "work",
              provider: provider.id,
              label: "OpenAI Codex 2",
              configured: true,
            },
          ],
        },
      ],
    });
    await Bun.sleep(0);
    expect(useStore.getState().bootstrap.providers[0]?.configured).toBe(false);
    expect(
      useStore.getState().bootstrap.providers[0]?.accounts?.[0]?.configured,
    ).toBe(true);
  });

  test("a committed login that finishes after its popup was closed still refreshes accounts without changing selection", async () => {
    bootstrap = Promise.withResolvers<Bootstrap>();
    const previous = useStore.getState().providerSelection;
    const count = refreshes;
    receive({
      provider: provider.id,
      loginId: "closed",
      accountId: "another",
      kind: "success",
    });
    expect(refreshes).toBe(count + 1);
    expect(useStore.getState().providerSelection).toBe(previous);
    bootstrap.resolve(state);
    await Bun.sleep(0);
  });
}
