import type { ReactNode } from "react";

/** Reveal window chrome by clipping the page, never by resizing its layout. */
export function MainViewport({
  busy,
  children,
}: {
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <main aria-busy={busy}>
      <div className="main-clip">
        <div className="main-viewport">{children}</div>
      </div>
    </main>
  );
}
