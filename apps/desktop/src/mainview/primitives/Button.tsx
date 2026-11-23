import type { ComponentPropsWithoutRef } from "react";
import "./button.css";

export function Button({
  variant = "secondary",
  type = "button",
  ...props
}: Omit<ComponentPropsWithoutRef<"button">, "className"> & {
  variant?: "primary" | "secondary";
}) {
  return <button {...props} type={type} className={variant} />;
}
