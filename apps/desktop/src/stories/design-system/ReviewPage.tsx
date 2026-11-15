import type { ReactNode } from "react";
import type { Evidence } from "./catalog";
import "./catalog.css";

/** Storybook-only documentation shell; never imported by the production UI. */
export function CatalogPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="ds-review" aria-label={title}>
      <header className="ds-review-header">
        <span className="ds-review-kicker">Design system · Review only</span>
        <h1>{title}</h1>
        <p>{intro}</p>
        <p className="ds-review-boundary">
          Storybookで方針を確認する段階です。本番UI・共通CSS・通信処理は変更せず、
          合意後に部品ごとに移行します。ここでの操作はサンプル内で完結します。
        </p>
      </header>
      {children}
    </main>
  );
}

export function CatalogSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="ds-review-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Example({
  title,
  evidence,
  source,
  use,
  avoid,
  children,
}: {
  title: string;
  evidence: Evidence;
  source: string;
  use: string;
  avoid: string;
  children: ReactNode;
}) {
  return (
    <section className="ds-review-card" data-ui-surface="card">
      <header>
        <span className="ds-review-tag">{evidence}</span>
        <h3>{title}</h3>
        <code className="ds-review-source">{source}</code>
      </header>
      <dl className="ds-review-guidance">
        <div>
          <dt>使うとき</dt>
          <dd>{use}</dd>
        </div>
        <div>
          <dt>使わないとき</dt>
          <dd>{avoid}</dd>
        </div>
      </dl>
      <div className="ds-review-demo">{children}</div>
    </section>
  );
}
