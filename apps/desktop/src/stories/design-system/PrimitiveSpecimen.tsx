import type { ReactNode } from "react";
import "./specimen.css";

export function PrimitiveSpecimen({
  layer = "Primitives",
  wide,
  title,
  intro,
  context,
  children,
  variants = [],
}: {
  layer?: "Primitives" | "Patterns" | "Domain" | "ChatRenderer";
  wide?: boolean;
  title: string;
  intro: string;
  context: string;
  children: ReactNode;
  variants?: readonly { label: string; sample: ReactNode }[];
}) {
  const renderer = layer === "ChatRenderer";
  return (
    <main className="ds-specimen" data-wide={wide || renderer || undefined}>
      <header>
        <small>{renderer ? layer : `Design system / ${layer}`}</small>
        <h1>{title}</h1>
        <p>{intro}</p>
      </header>
      <figure className="ds-specimen-stage">
        <figcaption>{context}</figcaption>
        <div className="ds-specimen-example">{children}</div>
      </figure>
      {variants.length > 0 && (
        <section aria-label="バリエーション">
          <h2>バリエーション</h2>
          <div className="ds-specimen-variants">
            {variants.map(({ label, sample }) => (
              <figure key={label}>
                <div className="ds-specimen-sample">{sample}</div>
                <figcaption>{label}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
