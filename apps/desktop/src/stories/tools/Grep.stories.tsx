import { toolControls, toolStories } from "../DesignProposals";
import { Grep } from "../tool-fixtures";
export default { title: "Chat/Tools/Grep", ...toolControls };
const stories = toolStories(Grep);
export const GrepDefault = { ...stories.Default, name: "Default" };
export const GrepLedger = { ...stories.Ledger, name: "Search table" };
export const GrepSheet = { ...stories.Sheet, name: "File explorer" };
export const GrepReceipt = { ...stories.Receipt, name: "Match cards" };
export const GrepCompare = stories.Compare;
