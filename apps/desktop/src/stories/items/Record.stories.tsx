import { RecordDetails } from "../item-fixtures";
import { RecordDefault, recordProposals } from "../proposals/content";
import { contentStories } from "../proposals/kit";

export default { title: "Chat/Extensions/Record" };
const stories = contentStories(recordProposals, RecordDefault);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Fields = stories.Fields;
export const Event = stories.Event;
export const Tree = stories.Tree;
export const Details = { render: RecordDetails };
