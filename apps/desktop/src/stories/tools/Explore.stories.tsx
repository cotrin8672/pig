import { contentStories } from "../DesignProposals";
import { ExploreGroup } from "../tool-fixtures";
export default { title: "Chat/Tools/Explore group" };
const stories = contentStories("explore", ExploreGroup);
export const Default = stories.Default;
export const ExplorationTimeline = stories.Rail;
export const FileWorkspace = stories.Sheet;
export const OperationMatrix = stories.Folded;
export const ExplorationComparison = {
  ...stories.Compare,
  name: "Compare all",
};
