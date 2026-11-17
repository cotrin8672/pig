import type {
  AdapterKeymap,
  SessionUIState,
} from "../../../../packages/config/src";

/** Adapter keys usable now: matching surface, registered command, idle operation. */
export function adapterBindings(
  state: SessionUIState | undefined,
  context: AdapterKeymap["when"] | null,
) {
  if (!state || !context) return [];
  return state.keymaps.filter(
    (binding) =>
      binding.when === context &&
      state.commands.some(
        (command) =>
          command.adapterId === binding.adapter &&
          command.id === binding.command &&
          !command.busy,
      ),
  );
}
