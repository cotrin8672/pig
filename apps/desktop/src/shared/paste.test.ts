import { expect, test } from "bun:test";
import { expandMarkers, makeMarker, shouldCollapse } from "./paste";

test("collapse thresholds are strictly above 10 lines or 1000 characters", () => {
  expect(shouldCollapse(Array(10).fill("x").join("\n"))).toBe(false);
  expect(shouldCollapse(Array(11).fill("x").join("\n"))).toBe(true);
  expect(shouldCollapse("x".repeat(1000))).toBe(false);
  expect(shouldCollapse("x".repeat(1001))).toBe(true);
});

test("markers prefer line counts and normalize CRLF", () => {
  expect(makeMarker(1, Array(11).fill("x").join("\r\n"))).toBe(
    "[paste #1 +11 lines]",
  );
  expect(makeMarker(2, "x".repeat(1001))).toBe("[paste #2 1001 chars]");
  expect(expandMarkers("[paste #1 3 chars]", new Map([[1, "a\r\nb"]]))).toBe(
    "a\nb",
  );
});

test("only registered exact markers expand, without recursion", () => {
  const pastes = new Map([
    [1, "[paste #2 5 chars]"],
    [2, "hello"],
  ]);
  expect(expandMarkers(makeMarker(1, pastes.get(1) ?? ""), pastes)).toBe(
    "[paste #2 5 chars]",
  );
  expect(expandMarkers("[paste #99 5 chars]", pastes)).toBe(
    "[paste #99 5 chars]",
  );
  expect(expandMarkers("[paste #2 6 chars]", pastes)).toBe(
    "[paste #2 6 chars]",
  );
  expect(expandMarkers("before [paste #2 5 chars] after", pastes)).toBe(
    "before hello after",
  );
});
