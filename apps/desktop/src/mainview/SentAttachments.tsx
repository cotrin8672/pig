import { FileText, Image as ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ImageGallery } from "./ImageGallery";
import { rpc } from "./rpc";

export function SentAttachments({ paths }: { paths: string[] }) {
  return (
    <div className="sent-attachments">
      {paths.map((path) => (
        <SentAttachment key={path} path={path} />
      ))}
    </div>
  );
}

function SentAttachment({ path }: { path: string }) {
  const image = /\.(png|jpe?g|gif|webp)$/i.test(path);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!image) return;
    let active = true;
    void rpc.request
      .attachmentPreview({ path })
      .then((value) => {
        if (active) setSrc(value);
      })
      .catch(() => {
        /* Unavailable files keep their attachment card. */
      });
    return () => {
      active = false;
    };
  }, [path, image]);
  const name = path.split(/[\\/]/).pop() ?? path;
  const Icon = image ? ImageIcon : FileText;
  return src ? (
    <ImageGallery sources={[src]} />
  ) : (
    <div className="sent-attachment" title={path}>
      <Icon size={24} aria-hidden="true" />
      <span>{name}</span>
    </div>
  );
}
