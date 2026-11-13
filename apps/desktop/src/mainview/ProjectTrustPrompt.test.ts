import { expect, test } from "bun:test";
import { projectName, projectRelative } from "./ProjectTrustPrompt";

test("project resources are shown relative to the project folder", () => {
  const cwd = "C:\\Users\\me\\repo";
  expect(projectRelative(cwd, "C:\\Users\\me\\repo\\AGENTS.md")).toBe(
    "AGENTS.md",
  );
  expect(projectRelative(`${cwd}\\`, "c:\\users\\me\\repo\\.pi\\a.ts")).toBe(
    ".pi\\a.ts",
  );
  expect(projectRelative(cwd, "C:\\Users\\me\\repo2\\AGENTS.md")).toBe(
    "C:\\Users\\me\\repo2\\AGENTS.md",
  );
  expect(projectRelative("/home/me/repo", "/home/me/repo/x/y.md")).toBe(
    "x/y.md",
  );
  expect(projectRelative("/home/me/Repo", "/home/me/repo/x.md")).toBe(
    "/home/me/repo/x.md",
  );
  expect(projectName("C:\\Users\\me\\repo\\")).toBe("repo");
});
