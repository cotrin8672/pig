import { expect, test } from "bun:test";
import { InstallerUpdater } from "./installer-updater";

test("disabling nightly invalidates an outstanding check and its install candidate", async () => {
  let nightly = true;
  const pending = Promise.withResolvers<string | null>();
  let installs = 0;
  const updater = new InstallerUpdater(
    "1.0.1",
    {
      check: (include) => (include ? pending.promise : Promise.resolve(null)),
      prepare: async () => {},
      install: async () => {
        installs++;
      },
    },
    () => nightly,
    () => {},
    async (prepare) => {
      await (await prepare())();
      return true;
    },
  );
  const first = updater.check();
  nightly = false;
  await updater.check();
  pending.resolve("1.0.2");
  await first;
  await updater.apply();
  expect(updater.info().status).toBe("current");
  expect(installs).toBe(0);
  nightly = true;
  await updater.check();
  await updater.apply();
  expect(installs).toBe(1);
});
