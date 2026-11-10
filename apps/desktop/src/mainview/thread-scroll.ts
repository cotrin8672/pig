export function isThreadAtBottom(
  element: Pick<HTMLElement, "scrollHeight" | "clientHeight" | "scrollTop">,
) {
  // scrollTop can be fractional while the height measurements are rounded.
  return element.scrollHeight - element.clientHeight - element.scrollTop <= 1;
}
