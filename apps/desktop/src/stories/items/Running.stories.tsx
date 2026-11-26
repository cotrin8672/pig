import { contentStories } from "../proposals/kit";
import { runningProposals } from "../proposals/running";
import { SpinnerGallery, spinnerProposals } from "../proposals/spinners";

export default { title: "Chat/Activity/Running" };

/** The line the app ships today: muted text, no motion. */
const RunningDefault = () => <p className="muted running">処理中</p>;

const stories = contentStories(
  { ...spinnerProposals, ...runningProposals },
  RunningDefault,
);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Gallery = {
  name: "Spinner gallery (enlarged)",
  render: () => <SpinnerGallery />,
};
export const Spinner = stories.Spinner;
export const Dots = stories.Dots;
export const Bars = stories.Bars;
export const Stardust = stories.Stardust;
export const Hourglass = stories.Hourglass;
export const Star = stories.Star;
export const Scanner = stories.Scanner;
