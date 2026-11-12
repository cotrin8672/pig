/** Provider IDs stay canonical; account IDs are pig-owned, stable identities. */
export interface ProviderAccount {
  id: string;
  provider: string;
  label: string;
  configured: boolean;
}
export type SessionAccounts = Record<string, string>;
export type AccountTarget = { provider: string; accountId?: string };

export function validateAccountId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw new Error("Invalid account ID.");
}
export function validateProviderId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 256 ||
    /[\p{Cc}]/u.test(value) ||
    ["__proto__", "constructor", "prototype"].includes(value)
  )
    throw new Error("Invalid provider ID.");
}
export function validateSessionAccounts(value: unknown): SessionAccounts {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid session accounts.");
  const entries = Object.entries(value);
  if (entries.length > 100) throw new Error("Too many session accounts.");
  for (const [provider, id] of entries) {
    validateProviderId(provider);
    validateAccountId(id);
  }
  return Object.fromEntries(entries);
}
