import {
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo,
  File as GenericFile,
} from "lucide-react";

const fileIcons: [RegExp, typeof GenericFile][] = [
  [/\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/i, FileArchive],
  [/\.(mp3|wav|flac|ogg|m4a|aac)$/i, FileAudio],
  [/\.(mp4|mov|mkv|webm|avi)$/i, FileVideo],
  [/\.(csv|tsv|xlsx?|ods)$/i, FileSpreadsheet],
  [/\.(md|txt|pdf|docx?|rtf|log)$/i, FileText],
  [
    /\.(ts|tsx|js|jsx|json|ya?ml|toml|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|rb|php|sh|ps1|html|css|sql|xml)$/i,
    FileCode,
  ],
];
export function FileIcon({ name, size }: { name: string; size: number }) {
  const Icon =
    fileIcons.find(([pattern]) => pattern.test(name))?.[1] ?? GenericFile;
  return <Icon size={size} aria-hidden="true" />;
}
