import { toolControls, toolStories } from "../DesignProposals";
import { Write } from "../tool-fixtures";
export default { title: "Chat/Tools/Write", ...toolControls };
const stories = toolStories(Write);
export const WriteDefault = { ...stories.Default, name: "Default" };
export const WriteLedger = { ...stories.Ledger, name: "New file editor" };
export const WriteSheet = { ...stories.Sheet, name: "File delivery" };
export const WriteReceipt = { ...stories.Receipt, name: "Creation patch" };
export const WriteCompare = stories.Compare;
