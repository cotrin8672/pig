import type { ReactNode } from "react";
import "./specimen.css";

export function PrimitiveSpecimen({
  title,
  intro,
  context,
  children,
  variants,
}: {
  title: string;
  intro: string;
  context: string;
  children: ReactNode;
  variants: readonly { label: string; sample: ReactNode }[];
}) {
  return (
    <main className="ds-specimen">
      <header>
        <small>Design system / Primitives</small>
        <h1>{title}</h1>
        <p>{intro}</p>
      </header>
      <figure className="ds-specimen-stage">
        <figcaption>{context}</figcaption>
        <div className="ds-specimen-example">{children}</div>
      </figure>
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
    </main>
  );
}
