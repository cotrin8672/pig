import { UserTurnWithAnnotations } from "../item-fixtures";
import { UserDefault, userProposals } from "../proposals/content";
import { contentStories } from "../proposals/kit";

export default { title: "Chat/Messages/User" };
const stories = contentStories(userProposals, UserDefault);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Checklist = stories.Checklist;
export const Clamp = stories.Clamp;
export const Heading = stories.Heading;
export const WithAnnotations = UserTurnWithAnnotations;
