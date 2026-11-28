import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("the ChatRenderer catalog has one page per production component", async () => {
  const directory = new URL(".", import.meta.url);
  const files = (await readdir(fileURLToPath(directory))).filter((file) =>
    file.endsWith(".stories.tsx"),
  );
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const name = file.replace(".stories.tsx", "");
    const source = await readFile(new URL(file, directory), "utf8");
    expect(source, file).toMatch(
      new RegExp(
        `title: "ChatRenderer/(Activity|Extensions|Messages|Tools)/${name}"`,
      ),
    );
    expect(source, file).toMatch(new RegExp(`component: ${name},`));
    expect(source, file).toMatch(new RegExp(`name: "${name}"`));
    expect(source.match(/^export (?!default\b)/gm), file).toHaveLength(1);
  }
});
