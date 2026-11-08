import type { PromptAccepted } from "../shared/rpc-schema";

type Accepted = (disposition: PromptAccepted["disposition"]) => void;

/** A prompt may stream for minutes; only its SDK preflight determines acceptance. */
export function awaitPromptAcceptance(
  run: (accept: Accepted) => Promise<void>,
  report: (error: unknown) => void,
): Promise<PromptAccepted> {
  return new Promise((resolve, reject) => {
    let accepted = false;
    void Promise.resolve()
      .then(() =>
        run((disposition) => {
          if (accepted) return;
          accepted = true;
          resolve({ disposition });
        }),
      )
      .then(
        () => {
          if (!accepted)
            reject(new Error("Prompt cancelled before acceptance."));
        },
        (error: unknown) => {
          if (accepted) report(error);
          else reject(error);
        },
      );
  });
}
