import { toolControls, toolStories } from "../DesignProposals";
import { Read } from "../tool-fixtures";
export default { title: "Chat/Tools/Read", ...toolControls };
const stories = toolStories(Read);
export const ReadDefault = { ...stories.Default, name: "Default" };
export const ReadLedger = { ...stories.Ledger, name: "Editor tab" };
export const ReadSheet = { ...stories.Sheet, name: "Range inspector" };
export const ReadReceipt = { ...stories.Receipt, name: "Source manuscript" };
export const ReadCompare = stories.Compare;
