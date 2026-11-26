export const defaultBindings = {
  "appearance.toggleBackdrop": "Ctrl+Shift+B",
  "navigation.back": "Alt+ArrowLeft",
  "navigation.forward": "Alt+ArrowRight",
  "settings.open": "Ctrl+,",
  "search.open": "Ctrl+K",
  "pane.splitRows": "Ctrl+Alt+H",
  "pane.splitColumns": "Ctrl+Alt+V",
  "pane.close": "Ctrl+Alt+W",
  "pane.left": "Ctrl+Alt+ArrowLeft",
  "pane.right": "Ctrl+Alt+ArrowRight",
  "pane.up": "Ctrl+Alt+ArrowUp",
  "pane.down": "Ctrl+Alt+ArrowDown",
  "composer.queue": "Shift+Enter",
  "composer.steer": "Ctrl+Enter",
  "composer.newline": "Enter",
} as const;
export type ActionId = keyof typeof defaultBindings;
export const actionIds = Object.keys(defaultBindings) as ActionId[];
export type KeyOverrides = Partial<Record<ActionId, string | null>>;

function keyName(key: string) {
  if (key === "+") return "Plus";
  if (key.length === 1) return key === " " ? "Space" : key.toUpperCase();
  const names = [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Enter",
    "Escape",
    "Tab",
    "Backspace",
    "Delete",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Insert",
    "Space",
    "Plus",
  ];
  return (
    names.find((name) => name.toLowerCase() === key.toLowerCase()) ??
    (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key) ? key.toUpperCase() : null)
  );
}
export function normalizeCombo(combo: string): string | null {
  const parts = combo.split("+").map((part) => part.trim());
  const key = keyName(parts.pop() ?? "");
  if (!key) return null;
  const modifiers = parts.map((part) => part.toLowerCase());
  if (
    new Set(modifiers).size !== modifiers.length ||
    modifiers.some((part) => !["ctrl", "alt", "shift", "meta"].includes(part))
  )
    return null;
  return [
    ...["Ctrl", "Alt", "Shift", "Meta"].filter((part) =>
      modifiers.includes(part.toLowerCase()),
    ),
    key,
  ].join("+");
}
/** Normalizes "<leader> p" / "Ctrl+X Ctrl+S" into space-joined combos; null if invalid. */
export function normalizeSequence(
  keys: string,
  leader?: string,
): string | null {
  const combos = keys
    .replace(/<leader>/gi, " <leader> ")
    .trim()
    // "Ctrl + K" stays one combo; only spaces not touching "+" separate keys.
    .split(/(?<!\+)\s+(?!\+)/)
    .map((part) =>
      /^<leader>$/i.test(part) ? (leader ?? null) : normalizeCombo(part),
    );
  return combos.every((combo) => combo !== null) ? combos.join(" ") : null;
}
/** Keys that type text, so an always-on sequence must not start with them in inputs. */
export function isTypingCombo(combo: string) {
  return /^(Shift\+)?(.|Space|Plus)$/.test(combo);
}
export const sequenceTimeoutMs = 1000;
/** One keypress of sequence matching; `pending` is the keys typed so far. */
export function sequenceStep(
  pending: string,
  combo: string,
  sequences: readonly string[],
): { match: string } | { pending: string } | null {
  const keys = pending ? `${pending} ${combo}` : combo;
  if (sequences.includes(keys)) return { match: keys };
  if (sequences.some((sequence) => sequence.startsWith(`${keys} `)))
    return { pending: keys };
  return null;
}
export type KeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;
export function comboFromEvent(event: KeyEvent): string | null {
  const key = keyName(event.key);
  if (!key) return null;
  return [
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Meta",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
export function matchesCombo(event: KeyEvent, combo: string | null): boolean {
  return (
    combo !== null &&
    normalizeCombo(combo) !== null &&
    comboFromEvent(event) === normalizeCombo(combo)
  );
}
export const composerActions = [
  "composer.queue",
  "composer.steer",
  "composer.newline",
] as const;
export function composerAction(event: KeyEvent, overrides: KeyOverrides) {
  const bindings = resolveBindings(overrides);
  return composerActions.find((action) =>
    matchesCombo(event, bindings[action]),
  );
}

export function resolveBindings(overrides: KeyOverrides) {
  // UI overrides replace defaults; TS config `keymaps` add keys on top (see shortcuts.ts).
  return { ...defaultBindings, ...overrides } as Record<
    ActionId,
    string | null
  >;
}
