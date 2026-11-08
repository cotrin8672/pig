export interface ProjectFlags {
  name?: string;
  pinned?: boolean;
  archived?: boolean;
}

export function validateProjectFlags(value: unknown): ProjectFlags {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid project state.");
  const input = value as ProjectFlags;
  const next: ProjectFlags = {};
  if (input.name !== undefined) {
    if (
      typeof input.name !== "string" ||
      input.name.length > 512 ||
      /[\p{Cc}]/u.test(input.name)
    )
      throw new Error("Invalid project name.");
    next.name = input.name.trim();
  }
  for (const key of ["pinned", "archived"] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean")
        throw new Error("Invalid project state.");
      next[key] = input[key];
    }
  }
  if (!Object.keys(next).length)
    throw new Error("Choose a project state to change.");
  return next;
}

export function knownProject(cwd: unknown, projects: string[]): string {
  if (
    typeof cwd !== "string" ||
    !cwd ||
    /[\p{Cc}]/u.test(cwd) ||
    !projects.includes(cwd)
  )
    throw new Error("Project not found. Refresh the project list.");
  return cwd;
}

export function visibleProjects(
  projects: string[],
  flags: Record<string, ProjectFlags> = {},
  archived = false,
) {
  return projects
    .filter((cwd) => !!flags[cwd]?.archived === archived)
    .sort((a, b) => Number(!!flags[b]?.pinned) - Number(!!flags[a]?.pinned));
}

export function withoutProject(projects: string[], cwd: unknown) {
  const known = knownProject(cwd, projects);
  return projects.filter((path) => path !== known);
}
