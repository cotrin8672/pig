import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

export const DisclosureContext = createContext<{
  values?: Record<string, boolean>;
  scope: string;
  reveal: number;
}>({ scope: "", reveal: 0 });

/** Only small view state survives navigation, never the body DOM. */
export function DisclosureScope({
  id,
  values,
  reveal,
  children,
}: {
  id: string;
  values?: Record<string, boolean>;
  reveal?: number;
  children: ReactNode;
}) {
  const parent = useContext(DisclosureContext);
  const resolvedValues = values ?? parent.values;
  const resolvedReveal = reveal ?? parent.reveal;
  const scope = `${parent.scope}/${id}`;
  const context = useMemo(
    () => ({ values: resolvedValues, scope, reveal: resolvedReveal }),
    [resolvedValues, scope, resolvedReveal],
  );
  return (
    <DisclosureContext.Provider value={context}>
      {children}
    </DisclosureContext.Provider>
  );
}

export function LazyDetails({
  summary,
  children,
  className,
  name = "body",
}: {
  summary: ReactNode;
  children: () => ReactNode;
  className?: string;
  name?: string;
}) {
  const { values, scope, reveal } = useContext(DisclosureContext);
  const key = `${scope}/${name}`;
  const [open, setOpen] = useState(() => !!reveal || !!values?.[key]);
  useLayoutEffect(() => {
    if (reveal) {
      setOpen(true);
      if (values) values[key] = true;
    }
  }, [reveal, key, values]);
  return (
    <details
      className={className}
      data-disclosure={name}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (values) values[key] = next;
        setOpen(next);
      }}
    >
      <summary>{summary}</summary>
      {open && children()}
    </details>
  );
}
