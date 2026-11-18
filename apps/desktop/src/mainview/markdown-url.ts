import { defaultUrlTransform, type UrlTransform } from "react-markdown";
import { isFileLink } from "../shared/file-links";
import { sessionIdFromLink } from "../shared/session-links";

export const markdownUrl: UrlTransform = (url, key, node) =>
  key === "href" &&
  node.tagName === "a" &&
  (isFileLink(url) || sessionIdFromLink(url))
    ? url
    : defaultUrlTransform(url);
