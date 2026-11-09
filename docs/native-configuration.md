# Native configuration (API v2)

Export a trusted TypeScript config with `defineConfig` from `@pig/config` and
`apiVersion: 2`. Use native `@earendil-works/pi-durable` extensions/tools and
`@earendil-works/pi-ai` providers, not legacy SDK extension objects. Version 1
requires migration; unknown config/runtime properties are rejected.

## Installed != loaded != selected

- **Installed** means package files are available. Installation does not import,
  scan, execute, or select their extensions or resources.
- **Loaded** means your config explicitly imports native definitions and supplies
  them to the runtime. `runtime.extensions` installs definitions in a workspace
  registry; it does not select them for every agent.
- **Selected** means a profile or explicit agent change chooses extensions,
  callable `tools`, and a model. `modelTools` only narrows model-visible tools;
  it cannot grant tools absent from `tools`. Making a provider available does not
  select a model; use `{ provider, modelId }` in a profile.

See [manual package installation](manual-package-installation.md). There is no
implicit package loading, installation, or resource discovery through these
config fields. Config modules and explicitly imported extensions execute as
trusted host code, **not in a sandbox**. Validation is not a security boundary:
imports and top-level code can already have run before shape validation.

## Provider factories

`@pig/config` exports these seams:

```ts
interface WorkspaceConfigContext {
  workspaceId: string;
  cwd: string;
}
type ProviderFactoryContext =
  | { scope: "catalog" }
  | ({ scope: "workspace" } & WorkspaceConfigContext);
type ProviderFactory = (
  context: ProviderFactoryContext,
) => Provider | Promise<Provider>;
```

`RuntimeConfig.providerFactories?: readonly ProviderFactory[]` accepts at most
128 functions. Validation checks function types, preserves their identities,
checks existing native provider/profile shapes, and does **not** invoke provider
factories or the resource callback.

Return a **fresh native Provider on every invocation**, including separate
catalog and workspace calls. Catalog calls have no workspace ID or cwd;
workspace calls identify the target workspace. Never return a module-level
provider singleton or share mutable provider/catalog/auth state between calls.
Use stable provider/model IDs even though each instance is fresh.

`runtime.providers` remains a native Provider array in the schema and retains
its structural checks. The desktop runtime rejects raw configured providers
unless an explicit fresh-provider creation port is supplied by its caller;
shape validation alone does not make singleton reuse safe. Use
`providerFactories` for normal configs.

## Explicit resources

The exported types are:

```ts
interface ResourcePaths {
  instructions: readonly string[];
  skills: readonly string[];
  prompts: readonly string[];
}
interface ConfigResourceSelection {
  global?: ResourcePaths;
  project?: ResourcePaths;
}
// New optional field; the other RuntimeConfig fields are unchanged.
interface RuntimeConfig {
  resources?: (
    workspace: WorkspaceConfigContext,
  ) => ConfigResourceSelection | Promise<ConfigResourceSelection>;
}
```

The callback returns only the global/project resources you explicitly choose.
Every returned path must be **absolute**; resolve known paths against `cwd` or
an explicitly chosen global directory. Do not return package names, globs,
`~` paths, or rely on workspace/package scanning. An omitted scope or empty
array does not request automatic discovery, installation, or extension import.
Only reference existing, trusted resources; explicit paths do not make their
contents trustworthy or provide filesystem isolation.

Resources are resolved **once per workspace lifetime**. Changing an initialized
resource selection requires a workspace/application restart; `config.reload`
does not hot-swap that selection. The host enforces this lifecycle.

## Offline example

This uses the native faux provider with no real authentication or network
access. Each call creates a new handle and provider. Resource paths are examples:
create/review those files or replace/remove the entries before using the config.
Populate `skills` and `prompts` with similarly explicit absolute paths when needed.

```ts
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { defineConfig, type ProviderFactory } from "@pig/config";

const createOfflineProvider: ProviderFactory = (context) => {
  const faux = fauxProvider({
    provider: "example.offline",
    models: [{ id: "demo", name: "Offline demo" }],
  });
  faux.setResponses([
    fauxAssistantMessage(
      context.scope === "catalog"
        ? "Offline catalog example"
        : `Offline example for ${context.workspaceId}`,
    ),
  ]);
  return faux.provider;
};

export default defineConfig({
  apiVersion: 2,
  runtime: {
    providerFactories: [createOfflineProvider],
    resources: ({ cwd }) => ({
      global: {
        instructions: [resolve(homedir(), ".config", "pig", "instructions.md")],
        skills: [],
        prompts: [],
      },
      project: {
        instructions: [resolve(cwd, "AGENTS.md")],
        skills: [],
        prompts: [],
      },
    }),
    profiles: {
      main: {
        extensions: [],
        tools: [],
        model: { provider: "example.offline", modelId: "demo" },
      },
    },
    defaultProfile: "main",
  },
});
```

## Commands, keymaps, and reload

The existing `commands`, `sessionAdapters`, and `keymaps` APIs are unchanged.
Host-command bindings use `{ keys, command, when }`; adapter bindings also name
`adapter`. Host commands and adapter commands remain separate contracts.
`config.reload` remains the reserved built-in host command, not a user command
ID. Reload still uses the host's validation and lifecycle/safety checks; it is
not an implicit install, rescan, or permission to replace initialized resources
or running native state. See the existing
[session UI config example](../examples/session-ui/config.ts) for native profiles,
commands, and adapter keymaps.
