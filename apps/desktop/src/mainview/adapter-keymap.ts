import type {
  AdapterKeymap,
  SessionUIState,
} from "../../../../packages/config/src";
import { type KeyEvent, matchesCombo } from "../shared/keymap";

export function adapterBinding(
  state: SessionUIState | undefined,
  event: KeyEvent,
  context: AdapterKeymap["when"] | null,
) {
  if (!state || !context) return undefined;
  return state.keymaps.find(
    (binding) =>
      binding.when === context &&
      matchesCombo(event, binding.keys) &&
      state.commands.some(
        (command) =>
          command.adapterId === binding.adapter &&
          command.id === binding.command &&
          !command.busy,
      ),
  );
}
