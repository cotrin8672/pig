import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accountSourceKey } from "../shared/account-models";
import type { DefaultModel } from "../shared/rpc-schema";
import { ARCHIMEDES_SESSION_NAME } from "../shared/supported-extensions";
import type { ModelSelect } from "./UtilityModelSettings";

if (process.env.PIG_SESSION_TITLE_SETTINGS_CHILD !== "1") {
  test("session title settings in an isolated renderer", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_SESSION_TITLE_SETTINGS_CHILD: "1" },
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
  let select: ComponentProps<typeof ModelSelect> | undefined;
  const calls: DefaultModel[] = [];
  let reject = false;
  mock.module("./rpc", () => ({
    rpc: {
      request: {
        setSessionTitleModel: async ({ model }: { model: DefaultModel }) => {
          calls.push(model);
          if (reject) throw new Error("Cannot save title model");
          return model ? `${model.provider}/${model.id}` : null;
        },
      },
    },
  }));
  mock.module("./UtilityModelSettings", () => ({
    ModelSelect: (props: ComponentProps<typeof ModelSelect>) => {
      select = props;
      return <span>{props.label}</span>;
    },
  }));
  const { SessionTitleSettings } = await import("./SessionTitleSettings");
  const { useStore } = await import("./store");
  const { sessionTitlePreference } = await import("./ui-mutations");
  const testModel = { provider: "test", id: "title", name: "Title model" };
  const disabled = { provider: "test", id: "disabled", name: "Disabled" };
  const secondary = { provider: "test", id: "other", name: "Other account" };

  test("offers the title picker only after installing the supported extension", () => {
    const html = renderToStaticMarkup(<SessionTitleSettings />);
    expect(html).toContain('data-setting="session-title-model"');
    expect(html).toContain(ARCHIMEDES_SESSION_NAME);
    expect(select).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("lists eligible models and saves, resets and rolls back only the title selection", async () => {
    const state = useStore.getInitialState();
    state.installed = [
      {
        source: `npm:${ARCHIMEDES_SESSION_NAME}@2.14.0`,
        scope: "user",
        types: ["extension"],
        updateAvailable: false,
      },
    ];
    state.bootstrap = {
      ...state.bootstrap,
      models: [testModel, disabled, secondary],
      disabledModels: ["test/disabled"],
      accountCatalogs: {
        [accountSourceKey("test")]: [testModel, disabled],
        [accountSourceKey("test", "secondary")]: [secondary],
      },
      sessionTitleModel: "manual/previous",
      defaultModel: secondary,
    };
    useStore.setState({ bootstrap: state.bootstrap });
    const html = renderToStaticMarkup(<SessionTitleSettings />);
    expect(html).toContain("part of the first exchange");
    if (!select) throw new Error("Expected the title model picker");
    expect(select.models).toEqual([testModel]);
    expect(select.value).toBe("manual/previous");
    expect(select.emptyLabel).toBe("Use the chat model");

    const model = { provider: testModel.provider, id: testModel.id };
    select.onChange(model);
    expect(useStore.getState().bootstrap.sessionTitleModel).toBe("test/title");
    await sessionTitlePreference.flush("session-title-model");
    reject = true;
    select.onChange(null);
    await sessionTitlePreference.flush("session-title-model");
    expect(useStore.getState().bootstrap.sessionTitleModel).toBe("test/title");
    expect(useStore.getState().notices.at(-1)?.message).toContain(
      "Cannot save title model",
    );
    reject = false;
    select.onChange(null);
    await sessionTitlePreference.flush("session-title-model");
    expect(calls).toEqual([model, null, null]);
    expect(useStore.getState().bootstrap.sessionTitleModel).toBeNull();
    expect(useStore.getState().bootstrap.defaultModel).toEqual(secondary);
  });
}
