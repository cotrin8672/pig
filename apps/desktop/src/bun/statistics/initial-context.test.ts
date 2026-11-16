import { expect, test } from "bun:test";
import { fixture } from "./fixtures";
import { initialContextMetadata, toolSourceLabel } from "./initial-context";

test("initial context counts normalized system sections and visible declarations, without retaining content", () => {
  const messages: Parameters<typeof initialContextMetadata>[0] = [
    {
      role: "system",
      content: "",
      timestamp: 1,
      sections: {
        preamble: "SECRET system",
        rules: "SECRET rules",
        project_context: "SECRET agents",
        skills: "SECRET skills",
      },
      toolsAdded: [
        {
          name: "read",
          description: "SECRET tool",
          parameters: { type: "object", properties: {} },
        },
      ],
    },
    {
      role: "system",
      content: "",
      timestamp: 2,
      sections: { plugin: "SECRET extension" },
      toolsAdded: [
        {
          name: "hidden",
          description: "SECRET hidden",
          parameters: { type: "object", properties: {} },
        },
      ],
    },
    {
      role: "system",
      content: "",
      timestamp: 3,
      toolsRemoved: [{ name: "hidden" }],
    },
    { role: "user", content: "SECRET USER does not contribute", timestamp: 4 },
  ];
  const metadata = initialContextMetadata(
    messages,
    200000,
    new Map([["read", "builtin"]]),
  );
  expect(metadata?.parts.map((p) => p.id)).toEqual([
    "base",
    "toolPrompts",
    "tools",
    "agents",
    "skills",
    "extensions",
  ]);
  expect(metadata?.tools.map((t) => [t.name, t.source])).toEqual([
    ["read", "builtin"],
  ]);
  expect(metadata?.sections.map((s) => s.id)).toEqual([
    "preamble",
    "rules",
    "project_context",
    "skills",
    "plugin",
  ]);
  expect(JSON.stringify(metadata)).not.toContain("SECRET");
  const { collector, events } = fixture();
  collector.initialContext(messages, 200000);
  collector.initialContext(messages, 200000);
  expect(events.filter((e) => e.type === "initial_context")).toHaveLength(1);
});

test("tool sources are short names, never full paths", () => {
  const info = (path: string, source: string, origin = "package") =>
    ({ path, source, origin, scope: "user" }) as Parameters<
      typeof toolSourceLabel
    >[0];
  expect(toolSourceLabel(info("builtin:read", "builtin"))).toBe("builtin");
  expect(toolSourceLabel(info("/x/i.ts", "npm:pi-lens@1.2.0"))).toBe("pi-lens");
  expect(toolSourceLabel(info("/x/i.ts", "npm:@scope/ext"))).toBe("@scope/ext");
  expect(toolSourceLabel(info("/x/i.ts", "git:github.com/u/repo@main"))).toBe(
    "repo",
  );
  expect(
    toolSourceLabel(
      info("C:\\Users\\me\\ext\\foo\\index.ts", "local", "top-level"),
    ),
  ).toBe("foo");
  expect(
    toolSourceLabel(
      info("/home/me/.pi/extensions/bar.ts", "local", "top-level"),
    ),
  ).toBe("bar");
  expect(toolSourceLabel(undefined)).toBeNull();
});
