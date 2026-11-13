const FLASH_MS = 1600;
const WAIT_MS = 2000;

/**
 * Waits for a search result's target to render, scrolls it into view, moves
 * focus to it (or its first control) and briefly marks it. Returns a cancel
 * function for effect cleanup.
 */
export function revealTarget(
  find: () => Element | null,
  done: (found: boolean) => void,
) {
  let frame = 0;
  const end = performance.now() + WAIT_MS;
  const attempt = () => {
    const element = find();
    if (!(element instanceof HTMLElement)) {
      if (performance.now() < end) frame = requestAnimationFrame(attempt);
      else done(false);
      return;
    }
    element.scrollIntoView({ block: "center" });
    const control = element.querySelector<HTMLElement>(
      "input, select, textarea, button:not(:disabled), summary, [tabindex]",
    );
    (control ?? element).focus({ preventScroll: true });
    element.classList.remove("search-target");
    // Restart the animation when the same target is chosen again.
    void element.offsetWidth;
    element.classList.add("search-target");
    // Not cancelled on cleanup: `done` usually clears the request that started this.
    setTimeout(() => element.classList.remove("search-target"), FLASH_MS);
    done(true);
  };
  frame = requestAnimationFrame(attempt);
  return () => cancelAnimationFrame(frame);
}
