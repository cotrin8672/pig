import { toolControls, toolStories } from "../DesignProposals";
import { Generic } from "../tool-fixtures";
export default { title: "Chat/Tools/Extension", ...toolControls };
const stories = toolStories(Generic);
export const ExtensionDefault = { ...stories.Default, name: "Default" };
export const ExtensionLedger = {
  ...stories.Ledger,
  name: "Request / Response",
};
export const ExtensionSheet = { ...stories.Sheet, name: "Call pipeline" };
export const ExtensionReceipt = {
  ...stories.Receipt,
  name: "Protocol transcript",
};
export const ExtensionCompare = stories.Compare;
