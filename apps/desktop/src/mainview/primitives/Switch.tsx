import type { ComponentPropsWithoutRef } from "react";
import "./switch.css";

/** The surrounding label names the control and makes its track clickable. */
export function Switch({ mixed = false, ...props }: Omit<ComponentPropsWithoutRef<"input">, "type" | "role" | "className"> & { mixed?: boolean }) {
  return <>
    <input {...props} type="checkbox" className="ui-switch-input" role={mixed ? "checkbox" : "switch"} aria-checked={mixed ? "mixed" : props.checked} ref={node => { if (node) node.indeterminate = mixed; }} />
    <span className="model-switch" data-mixed={mixed || undefined} aria-hidden="true" />
  </>;
}
