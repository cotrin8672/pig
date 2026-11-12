import { SingleImage } from "../item-fixtures";
import { ImagesDefault, imagesProposals } from "../proposals/content";
import { contentStories } from "../proposals/kit";

export default { title: "Chat/Media/Images" };
const stories = contentStories(imagesProposals, ImagesDefault);
export const Default = stories.Default;
export const Compare = stories.Compare;
export const Mosaic = stories.Mosaic;
export const Deck = stories.Deck;
export const Files = stories.Files;
export const Single = { render: SingleImage };
