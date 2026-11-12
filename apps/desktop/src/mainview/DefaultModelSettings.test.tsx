import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DefaultModel } from "../shared/rpc-schema";
import type { ModelSelect } from "./UtilityModelSettings";

if (process.env.PIG_DEFAULT_MODEL_SETTINGS_CHILD !== "1") {
  test("default model settings in an isolated renderer", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_DEFAULT_MODEL_SETTINGS_CHILD: "1" },
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
  let select: ComponentProps<typeof ModelSelect>;
  let save = async (model: DefaultModel) => model;
  mock.module("./rpc", () => ({
    rpc: {
      request: {
        setDefaultModel: ({ model }: { model: DefaultModel }) => save(model),
      },
    },
  }));
  mock.module("./UtilityModelSettings", () => ({
    ModelSelect: (props: ComponentProps<typeof ModelSelect>) => {
      select = props;
      return <span>{props.label}</span>;
    },
  }));
  const { DefaultModelSettings } = await import("./DefaultModelSettings");
  const { defaultModelPreference } = await import("./ui-mutations");
  const { useStore } = await import("./store");
  const model = { provider: "openai-codex", id: "sol", name: "Sol" };
  const hidden = { provider: "anthropic", id: "fable", name: "Fable" };

  test("settings show the saved default and offer only enabled models", () => {
    const state = useStore.getInitialState();
    const previous = state.bootstrap;
    state.bootstrap = {
      ...previous,
      models: [model, hidden],
      disabledModels: ["anthropic/fable"],
      defaultModel: model,
    };
    try {
      const html = renderToStaticMarkup(<DefaultModelSettings />);
      expect(html).toContain("Default model");
      expect(html).toContain("Existing chats keep their model.");
      expect(select.value).toEqual(model);
      expect(select.models).toEqual([model]);
      expect(select.emptyLabel).toBe("Automatic");
    } finally {
      state.bootstrap = previous;
    }
  });

  test("choosing a default saves it immediately; failures roll back and Automatic clears it", async () => {
    renderToStaticMarkup(<DefaultModelSettings />);
    const calls: DefaultModel[] = [];
    const written = { provider: model.provider, id: model.id };
    save = async (value) => {
      calls.push(value);
      return value;
    };
    select.onChange(written);
    expect(useStore.getState().bootstrap.defaultModel).toEqual(written);
    await defaultModelPreference.flush("default");
    expect(calls).toEqual([written]);
    // SSR reads the initial state; refresh its selected value for this interaction.
    useStore.getInitialState().bootstrap = useStore.getState().bootstrap;
    renderToStaticMarkup(<DefaultModelSettings />);
    save = async () => {
      throw new Error("Cannot save default");
    };
    select.onChange(hidden);
    await defaultModelPreference.flush("default");
    expect(useStore.getState().bootstrap.defaultModel).toEqual(written);
    expect(useStore.getState().notices.at(-1)?.message).toContain(
      "Cannot save",
    );
    save = async (value) => value;
    select.onChange(null);
    await defaultModelPreference.flush("default");
    expect(useStore.getState().bootstrap.defaultModel).toBeNull();
  });
}
