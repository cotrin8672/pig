import { Updater, Utils } from "electrobun/bun";
import { claimInstance, instancePipe } from "./single-instance";

// Claim the instance before loading the SDK: a second launch only asks the
// running app for another window, so one host owns sessions and config files.
let openWindow: (() => void) | undefined;
let requestedWindows = 0;
const onOpenWindow = () => {
  if (openWindow) openWindow();
  else requestedWindows++;
};
const pipe = instancePipe(await Updater.localInfo.channel());
let primary = true;
for (let attempt = 0; ; attempt++) {
  try {
    primary = !!(await claimInstance(pipe, onOpenWindow));
    break;
  } catch (error) {
    // The primary may have exited between our listen and connect attempts.
    // Never refuse to start: run unguarded, as before single-instance support.
    if (attempt >= 2) {
      console.error("Single-instance check failed; starting anyway:", error);
      break;
    }
    await Bun.sleep(200);
  }
}
if (primary) {
  ({ openWindow } = await import("./app"));
  for (; requestedWindows > 0; requestedWindows--) openWindow();
} else {
  console.log("[instance] pig is already running; opened another window");
  Utils.quit();
}
