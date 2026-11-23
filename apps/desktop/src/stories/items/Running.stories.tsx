import { contentStories } from "../proposals/kit";
import { runningProposals } from "../proposals/running";
import { SpinnerGallery, spinnerProposals } from "../proposals/spinners";

export default { title: "Chat/Activity/Running" };

/** The line the app ships today: muted text, no motion. */
const RunningDefault = () => <p className="muted running">処理中…</p>;

const stories = contentStories(
  { ...runningProposals, ...spinnerProposals },
  RunningDefault,
);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Gallery = {
  name: "TUI spinner gallery (enlarged)",
  render: () => <SpinnerGallery />,
};
export const Spinner = stories.Spinner;
export const Dots = stories.Dots;
export const Typing = stories.Typing;
export const Reel = stories.Reel;
export const Orbit = stories.Orbit;
export const Bars = stories.Bars;
export const Mixed = stories.Mixed;
export const BrailleComet = stories.BrailleComet;
export const BrailleWave = stories.BrailleWave;
export const Stardust = stories.Stardust;
export const LineBlur = stories.LineBlur;
export const BouncingBall = stories.BouncingBall;
export const Pong = stories.Pong;
export const Moon = stories.Moon;
export const Clock = stories.Clock;
export const Hourglass = stories.Hourglass;
export const Cube = stories.Cube;
export const Atom = stories.Atom;
export const Star = stories.Star;
export const StarShimmer = stories.StarShimmer;
export const Scanner = stories.Scanner;
export const Pacman = stories.Pacman;
