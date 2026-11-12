import { ExploreDefault, exploreContent } from "../proposals/content";
import { contentStories } from "../proposals/kit";

export default { title: "Chat/Tools/Explore group" };
const stories = contentStories(exploreContent, ExploreDefault);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Trail = stories.Trail;
export const Files = stories.Files;
export const Sentence = stories.Sentence;
