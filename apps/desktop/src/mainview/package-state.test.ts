import { expect, test } from "bun:test";
import type { InstalledPackage, PackageChange } from "../shared/packages";
import {
  compatibilityLabel,
  emptyPackageState,
  receivePackageEvent,
} from "./package-state";

const agentDir = "/isolated/profile";
const change: PackageChange = {
  agentDir,
  opId: "op",
  action: "update",
  source: "npm:fixture",
};
const pkg: InstalledPackage = {
  name: "fixture",
  source: "npm:fixture",
  scope: "user",
  types: [],
  compatibility: { status: "unverified" },
};

test("package failure preserves Installed; apply failure does not overwrite saved operation", () => {
  let state = receivePackageEvent(emptyPackageState(), agentDir, {
    type: "installed",
    agentDir,
    packages: [pkg],
  });
  state = receivePackageEvent(state, agentDir, {
    type: "operation",
    operation: { ...change, status: "error", message: "npm missing" },
  });
  expect(state.installed).toEqual([pkg]);
  state = receivePackageEvent(state, agentDir, {
    type: "operation",
    operation: { ...change, status: "done" },
  });
  state = receivePackageEvent(state, agentDir, {
    type: "apply",
    change,
    report: { status: "error", diagnostics: ["duplicate SDK module"] },
  });
  expect(state.operations).toHaveLength(1);
  expect(state.operations[0].status).toBe("done");
  expect(state.applications[0].report.status).toBe("error");
  expect(state.applications[0].report.diagnostics).toEqual([
    "duplicate SDK module",
  ]);
  expect(state.installed).toEqual([pkg]);
});
test("cross-profile events and diagnostics never leak to selected profile", () => {
  const state = emptyPackageState();
  expect(
    receivePackageEvent(state, "other", {
      type: "installed",
      agentDir,
      packages: [pkg],
    }),
  ).toBe(state);
  expect(
    receivePackageEvent(state, "other", {
      type: "operation",
      operation: { ...change, status: "running" },
    }),
  ).toBe(state);
  expect(
    receivePackageEvent(state, "other", {
      type: "apply",
      change,
      report: { status: "applied" },
    }),
  ).toBe(state);
  expect(
    receivePackageEvent(state, "other", {
      type: "diagnostic",
      agentDir,
      message: "private",
    }),
  ).toBe(state);
});
test("pending active/input-waiting sessions remain distinct and later reports replace by opId", () => {
  let state = receivePackageEvent(emptyPackageState(), agentDir, {
    type: "apply",
    change,
    report: {
      status: "pending",
      pendingSessionIds: ["active", "input-waiting"],
    },
  });
  expect(state.applications[0].report.pendingSessionIds).toEqual([
    "active",
    "input-waiting",
  ]);
  state = receivePackageEvent(state, agentDir, {
    type: "apply",
    change,
    report: { status: "applied" },
  });
  expect(state.applications).toHaveLength(1);
  expect(state.applications[0].report.status).toBe("applied");
});
test("diagnostic history is bounded; unknown compatibility labels are unverified", () => {
  let state = emptyPackageState();
  for (let i = 0; i < 100; i++)
    state = receivePackageEvent(state, agentDir, {
      type: "diagnostic",
      agentDir,
      message: String(i),
    });
  expect(state.diagnostics).toHaveLength(30);
  expect(state.diagnostics[0]).toBe("70");
  expect(compatibilityLabel("npm-safe")).toBe("UI unverified");
});
