import { toolControls, toolStories } from "../DesignProposals";
import { Find } from "../tool-fixtures";
export default { title: "Chat/Tools/Find", ...toolControls };
const stories = toolStories(Find);
export const FindDefault = { ...stories.Default, name: "Default" };
export const FindLedger = { ...stories.Ledger, name: "Path index" };
export const FindSheet = { ...stories.Sheet, name: "Folder explorer" };
export const FindReceipt = { ...stories.Receipt, name: "File tiles" };
export const FindCompare = stories.Compare;
