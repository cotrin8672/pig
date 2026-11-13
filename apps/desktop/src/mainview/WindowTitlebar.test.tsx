import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getT } from "./i18n";
import {
  isTitlebarHotzone,
  TitlebarHover,
  WindowTitlebar,
} from "./WindowTitlebar";

const waitForHide = () => Bun.sleep(350);

function setup() {
  const changes: boolean[] = [];
  let hovered = false;
  const hover = new TitlebarHover(
    (visible) => changes.push(visible),
    () => hovered,
  );
  return {
    hover,
    changes,
    setHovered: (value: boolean) => {
      hovered = value;
    },
  };
}

test("the trigger extends 32px down without covering the sidebar", () => {
  const collapsed = { left: 260, right: 1272, top: 0, bottom: 0 };
  expect(isTitlebarHotzone(600, 24, collapsed)).toBe(true);
  expect(isTitlebarHotzone(600, 32, collapsed)).toBe(true);
  expect(isTitlebarHotzone(600, 33, collapsed)).toBe(false);
  expect(isTitlebarHotzone(200, 24, collapsed)).toBe(false);
  expect(isTitlebarHotzone(1280, 24, collapsed)).toBe(false);
  expect(isTitlebarHotzone(600, -1, collapsed)).toBe(false);
  expect(isTitlebarHotzone(600, 34, { ...collapsed, bottom: 34 })).toBe(true);
});

test("only an expanded bar keeps a 24px margin on every edge", () => {
  const bounds = { left: 260, right: 1272, top: 0, bottom: 34 };
  for (const [x, y] of [
    [600, 58],
    [236, 24],
    [1296, 24],
    [600, -1],
    [600, -24],
  ]) {
    expect(isTitlebarHotzone(x, y, bounds, true)).toBe(true);
    expect(isTitlebarHotzone(x, y, bounds)).toBe(false);
  }
  expect(isTitlebarHotzone(600, 59, bounds, true)).toBe(false);
  expect(isTitlebarHotzone(235, 24, bounds, true)).toBe(false);
  expect(isTitlebarHotzone(1297, 24, bounds, true)).toBe(false);
  expect(isTitlebarHotzone(600, -25, bounds, true)).toBe(false);
});

test("hover opens immediately and leaving waits before hiding", async () => {
  const { hover, changes } = setup();
  hover.enter();
  expect(changes).toEqual([true]);
  hover.leave();
  expect(changes).toEqual([true]);
  await waitForHide();
  expect(changes).toEqual([true, false]);
  hover.dispose();
});

test("moving outside repeatedly does not postpone hiding indefinitely", async () => {
  const { hover, changes } = setup();
  hover.enter();
  hover.leave();
  await Bun.sleep(100);
  hover.leave();
  await Bun.sleep(250);
  expect(changes).toEqual([true, false]);
  hover.dispose();
});

test("returning before the hide delay cancels collapse", async () => {
  const { hover, changes } = setup();
  hover.enter();
  hover.leave();
  await Bun.sleep(220);
  expect(changes).toEqual([true]);
  hover.enter();
  await waitForHide();
  expect(changes).toEqual([true, true]);
  hover.dispose();
});

test("a transient native mouseleave does not hide a still-hovered bar", async () => {
  const { hover, changes, setHovered } = setup();
  hover.enter();
  hover.leave();
  setHovered(true);
  await waitForHide();
  expect(changes).toEqual([true]);
  hover.dispose();
});

test("a snapped-window leave above the client area preserves the expanded bar", async () => {
  const bounds = { left: 260, right: 1272, top: 0, bottom: 34 };
  let y = -1;
  const changes: boolean[] = [];
  const hover = new TitlebarHover(
    (visible) => changes.push(visible),
    (expanded) => isTitlebarHotzone(600, y, bounds, expanded),
  );
  hover.enter();
  hover.leave();
  await waitForHide();
  expect(changes).toEqual([true]);
  y = -25;
  hover.leave();
  await waitForHide();
  expect(changes).toEqual([true, false]);
  hover.dispose();
});

test("native dragging keeps the bar open until the mouse is released outside", async () => {
  const { hover, changes } = setup();
  hover.enter();
  hover.leave();
  hover.startDrag();
  hover.leave();
  await waitForHide();
  expect(changes).toEqual([true, true]);
  hover.endDrag();
  expect(changes).toEqual([true, true]);
  await waitForHide();
  expect(changes).toEqual([true, true, false]);
  hover.dispose();
});

test("releasing a drag over the bar keeps it visible", async () => {
  const { hover, changes, setHovered } = setup();
  hover.startDrag();
  setHovered(true);
  hover.endDrag();
  await waitForHide();
  expect(changes).toEqual([true, true]);
  hover.dispose();
});

test("blur or a window-state change clears dragging and pending hides", async () => {
  const { hover, changes } = setup();
  hover.startDrag();
  hover.reset();
  expect(changes).toEqual([true, false]);
  hover.enter();
  hover.leave();
  await waitForHide();
  expect(changes).toEqual([true, false, true, false]);
  hover.enter();
  hover.leave();
  hover.reset();
  const count = changes.length;
  await waitForHide();
  expect(changes).toHaveLength(count);
  hover.dispose();
});

test("the retention margin follows visibility and resets after hiding or blur", async () => {
  const states: boolean[] = [];
  const hover = new TitlebarHover(
    () => {},
    (expanded) => {
      states.push(expanded);
      return false;
    },
  );
  expect(hover.expanded).toBe(false);
  hover.enter();
  expect(hover.expanded).toBe(true);
  hover.leave();
  await waitForHide();
  expect(states).toEqual([true]);
  expect(hover.expanded).toBe(false);
  hover.enter();
  hover.reset();
  expect(hover.expanded).toBe(false);
  hover.dispose();
});

test("unmount cancels pending work", async () => {
  const { hover, changes } = setup();
  hover.enter();
  hover.leave();
  hover.dispose();
  await waitForHide();
  expect(changes).toEqual([true]);
});

test("the collapsed toolbar has a keyboard entry point and announces maximize or restore", () => {
  const t = getT();
  for (const maximized of [false, true]) {
    const html = renderToStaticMarkup(
      <WindowTitlebar maximized={maximized} onAction={() => {}} />,
    );
    expect(html).toContain('data-expanded="false"');
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('tabindex="0"');
    expect(html.match(/<button\b/g)).toHaveLength(3);
    expect(html).toContain(`aria-label="${t.Minimize}"`);
    expect(html).toContain(
      `aria-label="${maximized ? t.Restore : t.Maximize}"`,
    );
    expect(html).toContain(`aria-label="${t["Close window"]}"`);
    expect(html).not.toContain('tabindex="-1"');
    expect(html).not.toContain('inert=""');
    expect(html).not.toContain('disabled=""');
  }
});
