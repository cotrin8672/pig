/** These production surfaces unmount immediately. Keep only the discarded,
 * non-interactive DOM for the exit frame; never delay the actual action. */
export function previewExits(stage: HTMLElement) {
  const motion = matchMedia("(prefers-reduced-motion: no-preference)");
  const exiting = new Set<HTMLElement>();
  function discard(node: HTMLElement) {
    const group = node.parentElement;
    exiting.delete(node);
    node.remove();
    if (group?.hasAttribute("data-lab-threads") && !group.childElementCount)
      group.remove();
  }
  function clear() {
    for (const node of exiting) discard(node);
  }
  const observer = new MutationObserver((records) => {
    if (!motion.matches) return;
    for (const { target, removedNodes } of records) {
      if (!(target instanceof HTMLElement) || !stage.contains(target)) continue;
      for (const node of removedNodes) {
        if (
          !(node instanceof HTMLElement) ||
          node.hasAttribute("data-lab-exit")
        )
          continue;
        if (
          !(
            target.matches(".model-picker:not([open])") &&
            node.matches(".model-panel")
          ) &&
          !(
            target.matches(".main-viewport") && node.matches(".content-page")
          ) &&
          !(
            target.matches(".project-threads[hidden]") &&
            node.matches(".thread-row")
          )
        )
          continue;
        node.inert = true;
        node.dataset.labExit = "";
        if (target.matches(".project-threads")) {
          let group = target.nextElementSibling;
          if (!group?.hasAttribute("data-lab-threads")) {
            const threads = document.createElement("div");
            threads.className = "project-threads";
            threads.dataset.labThreads = "";
            threads.inert = true;
            target.after(threads);
            group = threads;
          }
          group.append(node);
        } else target.append(node);
        exiting.add(node);
        const surface = node.querySelector(".content-page-shell") ?? node;
        const animations = surface
          .getAnimations()
          .filter(
            (a) =>
              a instanceof CSSAnimation &&
              a.animationName.startsWith("desktop-motion-"),
          );
        for (const animation of animations) {
          animation.currentTime = Number(
            animation.effect?.getTiming().duration,
          );
          animation.reverse();
        }
        Promise.allSettled(animations.map((a) => a.finished)).then(() =>
          discard(node),
        );
      }
    }
  });
  observer.observe(stage, { subtree: true, childList: true });
  motion.addEventListener("change", clear);
  return () => {
    observer.disconnect();
    motion.removeEventListener("change", clear);
    clear();
  };
}
