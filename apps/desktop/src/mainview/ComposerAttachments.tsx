import { X } from "lucide-react";
import { useMemo } from "react";
import type { DraftContent } from "../shared/runtime-contract";
import { attachmentReads } from "./composer-attachments";
import { ImagePreview } from "./ImageGallery";
import { useT } from "./i18n";
import { FileIcon } from "./primitives/FileIcon";
import { Spinner } from "./primitives/Spinner";

export function ComposerAttachments({
  images,
  files,
  loads,
  onRemoveImage,
  onRemoveFile,
}: Pick<DraftContent, "images" | "files"> & {
  loads: ReturnType<typeof attachmentReads.read>;
  onRemoveImage: (id: string) => void;
  onRemoveFile: (id: string) => void;
}) {
  const t = useT();
  const sources = useMemo(
    () =>
      images.map(({ image }) => `data:${image.mimeType};base64,${image.data}`),
    [images],
  );
  const removeButton = (name: string, onClick: () => void) => (
    <button
      type="button"
      className="composer-attachment-remove"
      aria-label={`${t["Remove attachment"]}: ${name}`}
      onClick={onClick}
    >
      <X size={14} aria-hidden="true" />
    </button>
  );
  return (
    <>
      {images.map(({ id }, index) => {
        const name = t.imageN(index + 1, images.length);
        return (
          <div className="composer-attachment" key={id}>
            <ImagePreview sources={sources} index={index} alt={name} />
            {removeButton(name, () => onRemoveImage(id))}
          </div>
        );
      })}
      {files?.map(({ id, name, path }) => (
        <div
          className="composer-attachment file"
          key={id}
          aria-description={path}
        >
          <FileIcon name={name} size={28} />
          <span>{name}</span>
          {removeButton(name, () => onRemoveFile(id))}
        </div>
      ))}
      {loads
        .filter((load) => load.preview)
        .map(({ id, kind, name }) => (
          <div
            className={`composer-attachment pending ${kind === "file" ? "file" : ""}`}
            key={id}
            aria-description={name}
            aria-busy="true"
          >
            <Spinner size={22} />
            <span>{name}</span>
            {removeButton(name, () => attachmentReads.cancel(id))}
          </div>
        ))}
    </>
  );
}
