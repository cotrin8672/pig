import type { Pointer } from "bun:ffi";
import { expect, mock, test } from "bun:test";
import { createClientAreaSynchronizer } from "./window-layout";

const hwnd = 1 as Pointer;
const viewPtr = 2 as Pointer;
const makeView = () => ({
  ptr: viewPtr as Pointer | null,
  frame: { x: 0, y: 0, width: 1280, height: 840 },
});

test("WebView uses client dimensions, not the outer window frame", () => {
  const getRect = mock(() => [0, 0, 1264, 832]);
  const resize = mock((_view: Pointer, _frame: object) => {});
  const synchronize = createClientAreaSynchronizer({ getRect, resize });
  const view = makeView();
  expect(synchronize(hwnd, view)).toBe(true);
  expect(getRect).toHaveBeenCalledWith(hwnd);
  expect(resize).toHaveBeenCalledWith(viewPtr, {
    x: 0,
    y: 0,
    width: 1264,
    height: 832,
  });
  expect(view.frame).toEqual({ x: 0, y: 0, width: 1264, height: 832 });
});

test("each synchronization reads the current client area after resize/restore", () => {
  let rect = [0, 0, 2560, 980];
  const resize = mock((_view: Pointer, _frame: object) => {});
  const synchronize = createClientAreaSynchronizer({
    getRect: () => rect,
    resize,
  });
  const view = makeView();
  synchronize(hwnd, view);
  rect = [0, 0, 944, 692];
  synchronize(hwnd, view);
  expect(resize).toHaveBeenCalledTimes(2);
  expect(view.frame).toEqual({ x: 0, y: 0, width: 944, height: 692 });
});

test("zero, invalid, and unavailable client areas preserve the usable frame", () => {
  for (const rect of [null, [0, 0, 0, 0], [0, 0, 944, 0], [0, 0, -1, 692]]) {
    const resize = mock((_view: Pointer, _frame: object) => {});
    const synchronize = createClientAreaSynchronizer({
      getRect: () => rect,
      resize,
    });
    const view = makeView();
    const initial = view.frame;
    expect(synchronize(hwnd, view)).toBe(false);
    expect(resize).not.toHaveBeenCalled();
    expect(view.frame).toBe(initial);
  }
});

test("synchronization is a no-op without a native window or ready WebView", () => {
  const view = makeView();
  expect(createClientAreaSynchronizer()(hwnd, view)).toBe(false);
  const getRect = mock(() => [0, 0, 1264, 832]);
  const resize = mock((_view: Pointer, _frame: object) => {});
  view.ptr = null;
  expect(createClientAreaSynchronizer({ getRect, resize })(hwnd, view)).toBe(
    false,
  );
  expect(getRect).not.toHaveBeenCalled();
  expect(resize).not.toHaveBeenCalled();
});

test("a failed native resize does not publish an unapplied frame", () => {
  const view = makeView();
  const initial = view.frame;
  const synchronize = createClientAreaSynchronizer({
    getRect: () => [0, 0, 1264, 832],
    resize() {
      throw new Error("Resize failed");
    },
  });
  expect(() => synchronize(hwnd, view)).toThrow("Resize failed");
  expect(view.frame).toBe(initial);
});
