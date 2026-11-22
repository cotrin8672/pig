/** pi packages verified with pig. `verified` is the version tested with pig, not a pin. */
export const SUPPORTED_EXTENSIONS = [
  { name: "pi-subagents", verified: "0.89.1" },
  { name: "pi-ask-user", verified: "0.17.2" },
  { name: "pi-schedule-prompt", verified: "0.5.1" },
  { name: "pi-lens", verified: "4.5.1" },
  { name: "context-mode", verified: "2.2.1" },
  { name: "pi-codex-search", verified: "0.1.6" },
  { name: "pi-codex-tools", verified: "0.4.2" },
  { name: "@dietrichgebert/ponytail", verified: "5.3.3" },
  { name: "@bacnh85/pi-rtk", verified: "0.2.8" },
] as const;

export function supportedExtension(name: string) {
  return SUPPORTED_EXTENSIONS.find((pkg) => pkg.name === name);
}
