import { X } from "lucide-react";
import { useMemo } from "react";
import type { DraftContent } from "../shared/runtime-contract";
import { ImagePreview } from "./ImageGallery";
import { useT } from "./i18n";
import { FileIcon } from "./primitives/FileIcon";

export function ComposerAttachments({
  images,
  files,
  onRemoveImage,
  onRemoveFile,
}: Pick<DraftContent, "images" | "files"> & {
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
    </>
  );
}
