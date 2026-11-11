export interface AppBuild {
  channel: "stable" | "nightly" | "dev";
  version: string;
  commit: string;
}

export interface AppUpdateState {
  version: string;
  method: "scoop" | "portable" | "disabled";
  status:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "preparing"
    | "restarting"
    | "error";
  reason?: "nightly" | "development" | "unsupported" | "unknown";
  latest?: string;
  error?: string;
}

export const releaseBase =
  "https://github.com/cotrin8672/pig/releases/download";
export const updateZip = "pig-windows-x64.zip";

export function stableVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  );
}

export function newerVersion(next: string, current: string) {
  if (!stableVersion(next) || !stableVersion(current)) return false;
  const a = next.split(".").map(BigInt);
  const b = current.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function parseBuild(value: unknown): AppBuild | undefined {
  if (!value || typeof value !== "object") return;
  const build = value as Partial<AppBuild>;
  if (
    !["stable", "nightly", "dev"].includes(build.channel ?? "") ||
    typeof build.version !== "string" ||
    typeof build.commit !== "string" ||
    (build.channel === "stable" && !stableVersion(build.version))
  )
    return;
  return build as AppBuild;
}

export function parseRelease(value: unknown) {
  if (!value || typeof value !== "object")
    throw new Error("Invalid release metadata");
  const release = value as {
    tag_name?: unknown;
    draft?: unknown;
    prerelease?: unknown;
    assets?: unknown;
  };
  const version =
    typeof release.tag_name === "string" ? release.tag_name.slice(1) : "";
  if (
    release.tag_name !== `v${version}` ||
    !stableVersion(version) ||
    release.draft !== false ||
    release.prerelease !== false ||
    !Array.isArray(release.assets)
  )
    throw new Error("Not a stable release");
  const url = `${releaseBase}/v${version}/${updateZip}`;
  for (const name of [updateZip, `${updateZip}.sha256`]) {
    if (
      !release.assets.some(
        (asset: { name?: string; browser_download_url?: string }) =>
          asset?.name === name &&
          asset.browser_download_url === `${releaseBase}/v${version}/${name}`,
      )
    )
      throw new Error(`Missing release asset: ${name}`);
  }
  return { version, url };
}

export function parseChecksum(text: string) {
  const match = /^([a-f\d]{64})(?:\s+\*?pig-windows-x64\.zip)?\s*$/i.exec(
    text.trim(),
  );
  if (!match) throw new Error("Invalid release checksum");
  return match[1].toLowerCase();
}
