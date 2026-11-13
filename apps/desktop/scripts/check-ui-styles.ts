import { fileURLToPath } from "node:url";
import { lintUiCss, lintUiTsx, type UiStyleIssue } from "./ui-style-rules";

export async function checkUiStyles() {
  const root = fileURLToPath(new URL("../src/mainview/", import.meta.url));
  const issues: UiStyleIssue[] = [];
  let files = 0;
  for await (const path of new Bun.Glob("**/*.{css,tsx}").scan({
    cwd: root,
    absolute: true,
    onlyFiles: true,
  })) {
    if (path.endsWith(".test.tsx")) continue;
    const source = await Bun.file(path).text();
    issues.push(
      ...(path.endsWith(".css") ? lintUiCss : lintUiTsx)(source, path),
    );
    files++;
  }
  for (const issue of issues)
    console.error(
      `${issue.file}:${issue.line}:${issue.column} [${issue.rule}] ${issue.message}`,
    );
  console.info(`UI style policy: ${files} files, ${issues.length} violations.`);
  return issues;
}

if (import.meta.main) {
  try {
    if ((await checkUiStyles()).length) process.exitCode = 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
