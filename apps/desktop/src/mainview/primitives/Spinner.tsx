import { LoaderCircle } from "lucide-react";
import "./spinner.css";

/** Pass `label` only when no visible text already says what is loading. */
export function Spinner({
  size = 14,
  label,
}: {
  size?: number;
  label?: string;
}) {
  return label ? (
    <LoaderCircle
      size={size}
      className="spinner"
      role="img"
      aria-label={label}
    />
  ) : (
    <LoaderCircle size={size} className="spinner" aria-hidden="true" />
  );
}
