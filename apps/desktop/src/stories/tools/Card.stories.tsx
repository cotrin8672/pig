import { toolControls, toolStories } from "../DesignProposals";
import { ConfiguredCard } from "../tool-fixtures";
export default { title: "Chat/Tools/Configured card", ...toolControls };
const stories = toolStories(ConfiguredCard);
export const CardDefault = { ...stories.Default, name: "Default" };
export const CardLedger = { ...stories.Ledger, name: "Review dashboard" };
export const CardSheet = { ...stories.Sheet, name: "Evidence notebook" };
export const CardReceipt = { ...stories.Receipt, name: "Review checklist" };
export const CardCompare = stories.Compare;
