import { LoaderCircle } from "lucide-react";
import "./spinner.css";

export function Spinner({ size = 14 }: { size?: number }) {
  return <LoaderCircle size={size} className="spinner" aria-hidden="true" />;
}
