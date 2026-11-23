import type { ComponentPropsWithoutRef } from "react";
import "./button.css";
import "./icon-button.css";

export function IconButton({
  type = "button",
  ...props
}: Omit<ComponentPropsWithoutRef<"button">, "className"> & {
  "aria-label": string;
}) {
  return <button {...props} type={type} className="settings-icon-button" />;
}
