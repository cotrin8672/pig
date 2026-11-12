import { type UIEvent, useLayoutEffect, useRef } from "react";

type Position = { top: number; left: number };
// The disclosure owner controls lifetime; never retain a body or its DOM nodes.
const saved = new WeakMap<
  Record<string, boolean>,
  Map<string, Map<string, Position>>
>();

export function useDisclosureScroll(
  values: Record<string, boolean>,
  key: string,
  open: boolean,
) {
  const ref = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!open || !root) return;
    for (const [path, position] of saved.get(values)?.get(key) ?? []) {
      let element: Element | null = root;
      for (const index of path ? path.split(".") : [])
        element = element?.children.item(Number(index)) ?? null;
      if (element instanceof HTMLElement) {
        element.scrollTop = position.top;
        element.scrollLeft = position.left;
      }
    }
  }, [values, key, open]);

  function onScrollCapture(event: UIEvent<HTMLDetailsElement>) {
    const element = event.target;
    const root = event.currentTarget;
    if (
      !(element instanceof HTMLElement) ||
      element.closest("details[data-disclosure]") !== root ||
      !root.open ||
      !element.checkVisibility()
    )
      return;
    const path: number[] = [];
    let child: Element = element;
    while (child !== root) {
      const parent = child.parentElement;
      if (!parent) return;
      path.unshift(Array.from(parent.children).indexOf(child));
      child = parent;
    }
    let owner = saved.get(values);
    if (!owner) {
      owner = new Map();
      saved.set(values, owner);
    }
    let positions = owner.get(key);
    if (!positions) {
      positions = new Map();
      owner.set(key, positions);
    }
    positions.set(path.join("."), {
      top: element.scrollTop,
      left: element.scrollLeft,
    });
  }
  return { ref, onScrollCapture };
}
