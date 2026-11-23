import type { ComponentPropsWithRef } from "react";
import "./text-field.css";

export function TextField(
  props: Omit<ComponentPropsWithRef<"input">, "type"> & {
    type?: "text" | "search" | "email" | "url" | "password" | "tel";
  },
) {
  return <input {...props} />;
}
