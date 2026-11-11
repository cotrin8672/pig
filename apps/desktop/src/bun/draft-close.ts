/** Quit only after a durable ACK or the user's explicit choice to lose unsaved edits. */
export async function flushDraftsBeforeClose(
  flush: () => Promise<unknown>,
  choose: (error: unknown) => Promise<"retry" | "cancel" | "discard">,
  budgetMs = 5_000,
) {
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        flush(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Draft flush timed out")),
            budgetMs,
          );
        }),
      ]);
      return true;
    } catch (error) {
      const choice = await choose(error);
      if (choice !== "retry") return choice === "discard";
    } finally {
      clearTimeout(timer);
    }
  }
}
