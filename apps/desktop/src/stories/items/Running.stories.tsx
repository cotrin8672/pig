import { contentStories } from "../proposals/kit";
import { runningProposals } from "../proposals/running";

export default { title: "Chat/Activity/Running" };

/** The line the app ships today: muted text, no motion. */
const RunningDefault = () => <p className="muted running">処理中…</p>;

const stories = contentStories(runningProposals, RunningDefault);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Spinner = stories.Spinner;
export const Dots = stories.Dots;
export const Typing = stories.Typing;
export const Reel = stories.Reel;
export const Orbit = stories.Orbit;
export const Bars = stories.Bars;
export const Mixed = stories.Mixed;
