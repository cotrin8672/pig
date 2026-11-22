import { CURRENT_SESSION_VERSION } from "./sdk";

// Preview only: import the real SDK without opening a session or reading credentials.
console.log(
  JSON.stringify({
    bunVersion: Bun.version,
    sessionVersion: CURRENT_SESSION_VERSION,
  }),
);
