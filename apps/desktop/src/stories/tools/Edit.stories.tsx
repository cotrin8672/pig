import { toolControls, toolStories } from "../DesignProposals";
import { Edit } from "../tool-fixtures";
export default { title: "Chat/Tools/Edit", ...toolControls };
const stories = toolStories(Edit);
export const EditDefault = { ...stories.Default, name: "Default" };
export const EditLedger = { ...stories.Ledger, name: "Before / After" };
export const EditSheet = { ...stories.Sheet, name: "Patch review" };
export const EditReceipt = { ...stories.Receipt, name: "Revision switcher" };
export const EditCompare = stories.Compare;
