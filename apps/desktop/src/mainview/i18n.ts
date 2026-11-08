import { dictionary } from "../shared/i18n";
import { useStore } from "./store";

export function useT() {
  return dictionary(useStore((s) => s.settings.language));
}
export function getT() {
  return dictionary(useStore.getState().settings.language);
}
