import type { ComponentPropsWithRef } from "react";
import "./select.css";

export function Select(props: ComponentPropsWithRef<"select">) {
  return <select {...props} />;
}
