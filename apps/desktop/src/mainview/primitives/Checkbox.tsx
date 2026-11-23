import type { ComponentPropsWithoutRef } from "react";
import "./checkbox.css";

export function Checkbox({ mixed = false, ...props }: Omit<ComponentPropsWithoutRef<"input">, "type" | "className"> & { mixed?: boolean }) {
  return <input {...props} type="checkbox" className="ui-checkbox" ref={node => { if (node) node.indeterminate = mixed; }} />;
}
