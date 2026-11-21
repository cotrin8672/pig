/** pi packages pig displays natively. `verified` is the version tested with pig, not a pin. */
export const SUPPORTED_EXTENSIONS = [
  { name: "pi-subagents", verified: "0.89.1" },
  { name: "pi-ask-user", verified: "0.17.2" },
  { name: "pi-schedule-prompt", verified: "0.5.1" },
] as const;

export function supportedExtension(name: string) {
  return SUPPORTED_EXTENSIONS.find((pkg) => pkg.name === name);
}
