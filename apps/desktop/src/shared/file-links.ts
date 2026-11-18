export type FileReveal = { path: string } | { href: string; cwd?: string };

export function isFileLink(href: string) {
  return (
    !!href &&
    (/^(?:file:\/\/|[a-z]:(?:[\\/]|%5c))/i.test(href) ||
      !/^(?:[?#]|[\\/]{2}|[a-z][a-z\d+.-]*:)/i.test(href))
  );
}
