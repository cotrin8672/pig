export type PackageSource =
  | {
      kind: "npm";
      name: string;
      selector?: string;
      source: string;
      request: string;
    }
  | {
      kind: "github";
      url: string;
      ref?: string;
      source: string;
      request: string;
    };

const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const exactVersion =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isPackageName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 214 &&
    packageName.test(value) &&
    !value.split("/").some((part) => part === "." || part === "..")
  );
}

export const isExactPackageVersion = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && exactVersion.test(value);

function invalid(): never {
  // Do not echo inputs: rejected URLs may contain credentials.
  throw new Error(
    "Invalid package source: use an npm name/spec or a canonical GitHub repository URL without credentials",
  );
}

function npmSource(spec: string): PackageSource {
  const match =
    /^(?:(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)|([a-z0-9][a-z0-9._-]*))(?:@(.+))?$/.exec(
      spec,
    );
  if (!match) return invalid();
  const name = match[1] ?? match[2];
  const selector = match[3];
  // Intentionally exclude aliases, paths, URLs and compound/whitespace ranges.
  if (
    !isPackageName(name) ||
    (selector !== undefined &&
      (selector.length > 128 ||
        !/^(?:[A-Za-z0-9][A-Za-z0-9._-]*|[~^]?[0-9]+(?:\.[0-9xX*]+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|\*)$/.test(
          selector,
        )))
  )
    return invalid();
  const source = `npm:${name}`;
  return {
    kind: "npm",
    name,
    selector,
    source,
    request: `${source}${selector ? `@${selector}` : ""}`,
  };
}

function validRef(ref: string) {
  return (
    ref.length <= 200 &&
    /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(ref) &&
    !ref.includes("..") &&
    !ref
      .split("/")
      .some(
        (part) =>
          !part ||
          part.startsWith(".") ||
          part.endsWith(".") ||
          part.endsWith(".lock"),
      )
  );
}

/** Pure trust-boundary parser; it neither resolves versions nor reads credentials. */
export function parsePackageSource(value: unknown): PackageSource {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 512 ||
    /[\s\\]/.test(value) ||
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return invalid();

  const npmUrl = /^https:\/\/(?:www\.)?npmjs\.com\/package\/(.+)$/.exec(value);
  if (npmUrl) {
    let path: string;
    try {
      path = decodeURIComponent(npmUrl[1]).replace(/\/$/, "");
    } catch {
      return invalid();
    }
    const match = /^((?:@[^/]+\/)?[^/]+)(?:\/v\/([^/]+))?$/.exec(path);
    if (
      !match ||
      !isPackageName(match[1]) ||
      (match[2] !== undefined && !isExactPackageVersion(match[2]))
    )
      return invalid();
    return npmSource(`${match[1]}${match[2] ? `@${match[2]}` : ""}`);
  }

  const git =
    /^(https:\/\/github\.com\/|git@github\.com[:/]|ssh:\/\/git@github\.com\/)([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_][A-Za-z0-9._-]{0,99}?)(?:\.git)?(?:#(.+))?$/.exec(
      value,
    );
  if (git) {
    const repo = git[3];
    const ref = git[4];
    if (
      repo.includes("..") ||
      repo.endsWith(".") ||
      (ref !== undefined && !validRef(ref))
    )
      return invalid();
    const transport =
      git[1] === "https://github.com/"
        ? "https://github.com/"
        : "ssh://git@github.com/";
    const source = `${transport}${git[2].toLowerCase()}/${repo.toLowerCase()}.git`;
    return {
      kind: "github",
      url: source,
      ref,
      source,
      request: `${source}${ref ? `#${ref}` : ""}`,
    };
  }

  return npmSource(value.startsWith("npm:") ? value.slice(4) : value);
}

// UI matching helper; no keyword-based compatibility inference.
export function npmName(source: string) {
  if (!source.startsWith("npm:")) return undefined;
  try {
    const parsed = parsePackageSource(source);
    return parsed.kind === "npm" ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}
