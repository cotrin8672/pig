import type { MarketPackage } from "../shared/rpc-schema";

export interface DurableCatalogEntry {
  card: Readonly<MarketPackage>;
  /** Exact npm version or Git commit, reviewed by the catalog owner. */
  target: string;
  nativeCore: "1.5.0";
  /** Optional app-bundled asset, never a dynamically fetched preview. */
  preview?: string;
}

// Only the USER supplies candidates. Installation is separate from native load/selection.
export const durablePackageCatalog: readonly DurableCatalogEntry[] =
  Object.freeze([]);

export function searchCatalog(input: unknown, catalog = durablePackageCatalog) {
  const { query, page } = object(input);
  if (
    typeof query !== "string" ||
    query.length > 200 ||
    typeof page !== "number" ||
    !Number.isInteger(page) ||
    page < 0 ||
    page > 199
  )
    throw new Error(
      "Invalid package search: query must be at most 200 characters and page an integer from 0 to 199",
    );
  const needle = query.trim().toLowerCase();
  const items = catalog
    .map(({ card }) => card)
    .filter((card) =>
      [card.name, card.description, card.publisher ?? "", ...card.types]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    items: items
      .slice(page * 50, (page + 1) * 50)
      .map((card) => ({ ...card, types: [...card.types] })),
    total: items.length,
    pageSize: 50,
  };
}

export function catalogPreviews(
  input: unknown,
  catalog = durablePackageCatalog,
): Record<string, string | null> {
  const { names } = object(input);
  if (
    !Array.isArray(names) ||
    names.length > 64 ||
    !names.every(
      (name) =>
        typeof name === "string" && name.length > 0 && name.length <= 214,
    )
  ) {
    throw new Error("Invalid preview names (maximum 64)");
  }
  return Object.fromEntries(
    [...new Set<string>(names)].map((name) => {
      const preview = catalog.find(({ card }) => card.name === name)?.preview;
      const local =
        preview?.startsWith("/") &&
        !preview.startsWith("//") &&
        !preview.includes("..");
      return [name, local ? (preview ?? null) : null];
    }),
  );
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
