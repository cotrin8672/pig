// The canvas runs in a browser without Electrobun or a real session.
export const regenerate = async () => {};
export const forkChat = async () => {};
export const openChatLink = async () => {};
export const rpc = {
  send: {
    imageMenu: () => {},
    openExternal: ({ url }: { url: string }) =>
      window.open(url, "_blank", "noopener,noreferrer"),
  },
  request: {
    async copyImage({ src }: { src: string }) {
      const blob = await (await fetch(src)).blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    },
    async saveImage({ src }: { src: string }) {
      const link = document.createElement("a");
      link.href = src;
      link.download = "preview.png";
      link.click();
    },
  },
};
