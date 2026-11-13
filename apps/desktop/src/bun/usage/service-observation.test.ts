import { expect, test } from "bun:test";
import type { UsageData } from "../../shared/provider-usage";
import { UsageService } from "./service";

const data = (usedPercent: number): UsageData => ({
  windows: [{ id: "5h", label: "5h", usedPercent }],
  balances: [],
});
test("response observations cannot cross credential revisions", async () => {
  const service = new UsageService(
    async () => [
      {
        key: "a",
        provider: "anthropic",
        label: "Work",
        source: "api",
        revision: "owner-a",
        read: async () => data(20),
      },
    ],
    () => {},
  );
  await service.refresh();
  service.observe("a", data(80), "owner-b");
  expect(service.snapshot()[0].data?.windows[0].usedPercent).toBe(20);
  service.observe("a", data(30), "owner-a");
  expect(service.snapshot()[0].data?.windows[0].usedPercent).toBe(30);
  service.dispose();
});
test("a pending API response does not overwrite a newer chat-response observation", async () => {
  let finish!: (value: UsageData) => void;
  const pending = new Promise<UsageData>((resolve) => {
    finish = resolve;
  });
  const service = new UsageService(
    async () => [
      {
        key: "a",
        provider: "anthropic",
        label: "Work",
        source: "api",
        revision: "owner-a",
        read: async () => pending,
      },
    ],
    () => {},
  );
  const work = service.refresh();
  await Bun.sleep(1);
  service.observe("a", data(40), "owner-a");
  finish(data(20));
  await work;
  expect(service.snapshot()[0].data?.windows[0].usedPercent).toBe(40);
  expect(service.snapshot()[0].source).toBe("response");
  service.dispose();
});
