import type { CSSProperties, ReactNode } from "react";
import "./turn-spinner.css";

function Geometric({ children }: { children: ReactNode }) {
  return (
    <svg
      className="turn-spinner-geo"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function ComputeGrid() {
  return (
    <Geometric>
      {[
        [2.6, 2.6, "diag-a"],
        [9.4, 2.6, "cross"],
        [16.2, 2.6, "diag-b"],
        [2.6, 9.4, "cross"],
        [9.4, 9.4, "center"],
        [16.2, 9.4, "cross"],
        [2.6, 16.2, "diag-b"],
        [9.4, 16.2, "cross"],
        [16.2, 16.2, "diag-a"],
      ].map(([x, y, role]) => (
        <rect
          key={`${x}-${y}`}
          x={x as number}
          y={y as number}
          width="5.2"
          height="5.2"
          rx="1.2"
          fill="currentColor"
          stroke="none"
          className={`turn-spinner-geo-cell turn-spinner-geo-cell-${role}`}
        />
      ))}
    </Geometric>
  );
}

function HexWave() {
  return (
    <Geometric>
      {[
        { cx: 12, cy: 12, cls: "turn-spinner-geo-hex-core", delay: 0 },
        ...[0, 60, 120, 180, 240, 300].map((deg, i) => ({
          cx: 12 + Math.cos((deg * Math.PI) / 180) * 6.8,
          cy: 12 + Math.sin((deg * Math.PI) / 180) * 6.8,
          cls: "turn-spinner-geo-hex-ring",
          delay: -i * 0.22,
        })),
      ].map(({ cx, cy, cls, delay }) => (
        <g
          key={`${cx.toFixed(1)}-${cy.toFixed(1)}`}
          transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`}
        >
          <polygon
            points="0,-3.1 2.68,-1.55 2.68,1.55 0,3.1 -2.68,1.55 -2.68,-1.55"
            fill="currentColor"
            stroke="none"
            className={cls}
            style={{ animationDelay: `${delay}s` }}
          />
        </g>
      ))}
    </Geometric>
  );
}

function HelixPair() {
  return (
    <Geometric>
      {[0, 1].map((row) => (
        <g key={row} opacity={row ? 0.45 : 1}>
          {[4, 9, 14, 19].map((x, i) => (
            <circle
              key={x}
              cx={x}
              cy="12"
              r="1.65"
              fill="currentColor"
              stroke="none"
              className="turn-spinner-geo-phase-dot"
              style={{ animationDelay: `${-row - i * 0.22}s` }}
            />
          ))}
        </g>
      ))}
    </Geometric>
  );
}

function Vacancy() {
  return (
    <Geometric>
      {[
        [4, 4, 1, 0],
        [13, 4, 0, 1],
        [13, 13, -1, 0],
        [4, 13, 0, -1],
      ].map(([x, y, dx, dy], i) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="7"
          height="7"
          fill="currentColor"
          stroke="none"
          className="turn-spinner-geo-vacancy"
          style={
            {
              animationDelay: `${-i * 0.6}s`,
              "--dx": `${dx * 9}px`,
              "--dy": `${dy * 9}px`,
            } as CSSProperties
          }
        />
      ))}
    </Geometric>
  );
}

function PhaseSlits() {
  return (
    <Geometric>
      {[5, 10, 15, 20].map((x, i) => (
        <path
          key={x}
          d={`M${x} 5v14`}
          className="turn-spinner-geo-slit"
          style={{
            transformOrigin: `${x}px 12px`,
            animationDelay: `${-i * 0.18}s`,
          }}
        />
      ))}
    </Geometric>
  );
}

function OffsetArc() {
  return (
    <Geometric>
      <path d="M12 3a9 9 0 1 1-9 9" className="turn-spinner-geo-orbit" />
      <path
        d="M12 7a5 5 0 0 0 0 10"
        className="turn-spinner-geo-orbit turn-spinner-geo-counter"
      />
    </Geometric>
  );
}

function Mechanical({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="turn-spinner-machine"
      viewBox="0 0 32 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function Cradle() {
  return (
    <Mechanical>
      <path d="M5 3h22" opacity=".4" />
      {[10, 16, 22].map((x, i) => (
        <g
          key={x}
          className={["turn-spinner-m-left", "", "turn-spinner-m-right"][i]}
        >
          <path d={`M${x} 3v10`} />
          <circle cx={x} cy="15" r="2.4" fill="currentColor" />
        </g>
      ))}
    </Mechanical>
  );
}

function Switchboard() {
  return (
    <Mechanical>
      <path d="M2 15h9V7h9v6h10" opacity=".3" />
      <circle
        className="turn-spinner-m-pulse"
        r="1.5"
        fill="currentColor"
        stroke="none"
      />
    </Mechanical>
  );
}

const vars = (v: Record<string, string | number>) => v as CSSProperties;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function Stardust() {
  return (
    <span className="turn-spinner-dust">
      {range(16).map((i) => (
        <i
          key={i}
          style={{
            animationDuration: `${0.9 + ((i * 7) % 5) * 0.22}s`,
            animationDelay: `${-((i * 0.37) % 1.3)}s`,
          }}
        />
      ))}
    </span>
  );
}

function Hourglass() {
  return (
    <span className="turn-spinner-glass">
      <span className="turn-spinner-glass-top">
        <i />
      </span>
      <span className="turn-spinner-glass-stream">
        <i />
      </span>
      <span className="turn-spinner-glass-bottom">
        <i />
      </span>
    </span>
  );
}

const STAR = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
function Star() {
  return (
    <span className="turn-spinner-star">
      {STAR.map((glyph, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: frames repeat; the index is the frame's identity
        <i key={i} style={vars({ "--i": i })}>
          {glyph}
        </i>
      ))}
    </span>
  );
}

function Scanner() {
  return (
    <span className="turn-spinner-scan">
      {range(6).map((i) => (
        <i key={i} />
      ))}
      {range(3).map((i) => (
        <b key={i} style={vars({ "--i": i, opacity: [1, 0.5, 0.22][i] })} />
      ))}
    </span>
  );
}

function Spinner() {
  return (
    <svg
      className="turn-spinner-run-glyph"
      viewBox="0 0 16 20"
      aria-hidden="true"
    >
      {[0.06, 0.13, 0.26, 0.46, 0.72, 1].map((opacity, i) => (
        <circle
          key={opacity}
          r={1.15 + i * 0.13}
          opacity={opacity}
          style={{ animationDelay: `${-(i + 1) * 95}ms` }}
        />
      ))}
    </svg>
  );
}

function Dots() {
  return (
    <span className="turn-spinner-run-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function Bars() {
  return (
    <span className="turn-spinner-run-bars" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

export const TURN_SPINNERS = {
  ComputeGrid,
  HexWave,
  HelixPair,
  Vacancy,
  PhaseSlits,
  OffsetArc,
  Cradle,
  Switchboard,
  Stardust,
  Hourglass,
  Star,
  Scanner,
  Spinner,
  Dots,
  Bars,
};

export function TurnSpinner({
  variant,
}: {
  variant: keyof typeof TURN_SPINNERS;
}) {
  const Glyph = TURN_SPINNERS[variant];
  return (
    <span
      className="turn-spinner"
      aria-hidden="true"
      data-turn-spinner={variant}
    >
      <Glyph />
    </span>
  );
}
