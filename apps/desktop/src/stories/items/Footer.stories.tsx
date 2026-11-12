import { contentStories } from "../DesignProposals";
import { Footer } from "../item-fixtures";
export default { title: "Chat/Activity/Response footer" };
const stories = contentStories("footer", Footer);
export const Default = stories.Default;
export const MetricDashboard = stories.Rail;
export const RunReceipt = stories.Sheet;
export const CompactTelemetry = stories.Folded;
export const FooterComparison = { ...stories.Compare, name: "Compare all" };
