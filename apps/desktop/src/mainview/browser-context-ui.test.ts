import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fixtureBrowser,
  removeFixtureDirectory,
} from "../../scripts/ui-browser";
import { fixtureEdge } from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "UI fixtures use independent browser storage on the same origin",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pig-context-ui-"));
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response("<title>fixture</title>", {
          headers: { "content-type": "text/html" },
        }),
    });
    try {
      const open = async () =>
        fixtureBrowser(
          fixtureEdge,
          await mkdtemp(join(directory, "case-")),
          server.url.href,
        );
      const first = await open();
      try {
        await first.evaluate(
          "localStorage.setItem('isolation', 'first'); document.cookie='isolation=first'",
        );
        expect(await first.evaluate("localStorage.getItem('isolation')")).toBe(
          "first",
        );
        expect(await first.evaluate("document.cookie")).toBe("isolation=first");
      } finally {
        await first.close();
      }

      const second = await open();
      try {
        expect(
          await second.evaluate("localStorage.getItem('isolation')"),
        ).toBeNull();
        expect(await second.evaluate("document.cookie")).toBe("");
      } finally {
        await second.close();
      }
    } finally {
      await server.stop(true);
      await removeFixtureDirectory(directory);
    }
  },
  30_000,
);
