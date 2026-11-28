import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "../primitives/IconButton";
import "./copy-button.css";

export function CopyButton({
  label,
  copiedLabel = label,
  copy,
  onError,
  persistent = false,
  disabled,
  className,
  variant = "inline",
}: {
  label: string;
  copiedLabel?: string;
  copy: () => Promise<void>;
  onError: (error: unknown) => void;
  persistent?: boolean;
  disabled?: boolean;
} & (
  | { variant?: "inline"; className?: string }
  | { variant: "icon"; className?: never }
)) {
  const [copied, setCopied] = useState(0);
  useEffect(() => {
    if (!copied || persistent) return;
    const timer = setTimeout(() => setCopied(0), 1500);
    return () => clearTimeout(timer);
  }, [copied, persistent]);
  const button = {
    "aria-label": copied ? copiedLabel : label,
    disabled,
    onClick: async () => {
      try {
        await copy();
        setCopied((previous) => previous + 1);
      } catch (error) {
        onError(error);
      }
    },
    children: copied ? (
      <Check
        key={copied}
        size={14}
        className="completion-pop"
        aria-hidden="true"
      />
    ) : (
      <Copy size={14} aria-hidden="true" />
    ),
  };
  if (variant === "icon") return <IconButton {...button} />;
  return (
    <button
      {...button}
      type="button"
      className={className ? `copy-button ${className}` : "copy-button"}
    />
  );
}
