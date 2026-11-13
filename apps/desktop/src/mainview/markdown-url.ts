import { defaultUrlTransform } from "react-markdown";
import { sessionIdFromLink } from "../shared/session-links";
export const markdownUrl = (url: string) =>
  sessionIdFromLink(url) ? url : defaultUrlTransform(url);
