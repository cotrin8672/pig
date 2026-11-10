import type { PackageType } from "./rpc-schema";

const types: PackageType[] = ["extension", "skill", "theme", "prompt"];

// pi.dev classifies cards by npm keywords only (verified on 50/50 gallery cards).
export function classify(keywords: readonly string[] | undefined) {
  const k = (keywords ?? []).map((s) => s.toLowerCase());
  return types.filter((t) =>
    [t, `${t}s`, `pi-${t}`].some((x) => k.includes(x)),
  );
}

// "npm:@scope/name@^1" -> "@scope/name"; undefined for git/local sources.
export function npmName(source: string) {
  if (!source.startsWith("npm:")) return undefined;
  return source
    .slice(4)
    .trim()
    .match(/^(@[^/@]+\/[^@]+|[^@]+)/)?.[1];
}
