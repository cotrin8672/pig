import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config from "../electrobun.config";

for (const os of ["win", "linux", "macos"]) {
  for (const channel of ["dev", "canary", "stable"]) {
    test(`release metadata reaches the actual ${os}/${channel} bundle`, async () => {
      const root = await mkdtemp(join(tmpdir(), "pig-post-build-"));
      try {
        const name = `pig${channel === "stable" ? "" : `-${channel}`}`;
        const resources = join(
          root,
          `${name}${os === "macos" ? ".app/Contents" : ""}`,
          "Resources",
        );
        await mkdir(resources, { recursive: true });
        const env = {
          ...process.env,
          ELECTROBUN_BUILD_DIR: root,
          ELECTROBUN_APP_NAME: "pig",
          ELECTROBUN_BUILD_ENV: channel,
          ELECTROBUN_OS: os,
          PIG_RELEASE_CHANNEL: "nightly",
          PIG_RELEASE_VERSION: `${config.app.version}-nightly.fixture`,
          PIG_RELEASE_COMMIT: "fixture",
        };
        const run = () =>
          Bun.spawn(
            [process.execPath, join(import.meta.dir, "post-build.ts")],
            { env, stdout: "ignore", stderr: "ignore" },
          );
        // Do not write to a guessed or missing bundle destination.
        expect(await run().exited).not.toBe(0);
        await writeFile(join(resources, "version.json"), "{}");
        expect(await run().exited).toBe(0);
        expect(
          JSON.parse(await readFile(join(resources, "app-build.json"), "utf8")),
        ).toEqual({
          channel: "nightly",
          version: `${config.app.version}-nightly.fixture`,
          commit: "fixture",
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}
