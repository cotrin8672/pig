import { toolControls, toolStories } from "../DesignProposals";
import { Ls } from "../tool-fixtures";
export default { title: "Chat/Tools/List", ...toolControls };
const stories = toolStories(Ls);
export const ListDefault = { ...stories.Default, name: "Default" };
export const ListLedger = { ...stories.Ledger, name: "Directory table" };
export const ListSheet = { ...stories.Sheet, name: "Folder explorer" };
export const ListReceipt = { ...stories.Receipt, name: "File tiles" };
export const ListCompare = stories.Compare;
