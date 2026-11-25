import type { ComponentType, ReactNode } from "react";
import "./spinner-material.css";

function Mark({ children }: { children: ReactNode }) {
  return (
    <svg
      className="pp-material"
      viewBox="0 0 28 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function FoldingRibbon() {
  return (
    <Mark>
      <path d="M2 14 16 6v6L2 20l2-4Z" opacity=".5" />
      <g className="pp-material-fold">
        <path d="m16 6 10 5v6l-10-5Z" />
        <path d="m26 11-5 8v-6Z" opacity=".45" />
      </g>
    </Mark>
  );
}

function TypeTetrahedron() {
  return (
    <Mark>
      <g className="pp-material-tumble">
        <path d="m14 2 11 18-11-5Z" opacity=".38" />
        <path d="m3 20 11-5 11 5Z" opacity=".67" />
        {/* The triangular counter and crossbar cut a letter A into the face. */}
        <path
          fillRule="evenodd"
          d="M14 2 3 20l11-5ZM11.7 8.5l-4 7.8 1.4-.6.8-1.7 1.7-.7v1.4l1.1-.5V8Zm-.1 2.2v1.6l-1.1.5Z"
        />
      </g>
    </Mark>
  );
}

function MagneticInk() {
  return (
    <Mark>
      <g className="pp-material-ink">
        <circle cx="7" cy="12" r="4.5" className="pp-material-drop" />
        <circle
          cx="21"
          cy="12"
          r="4.5"
          className="pp-material-drop pp-material-right"
        />
        <path className="pp-material-neck" d="M9 9Q14 13 19 9v6q-5-4-10 0Z" />
      </g>
    </Mark>
  );
}

function Loom() {
  return (
    <Mark>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        d="M3 3h22M3 21h22"
      />
      <path
        stroke="currentColor"
        opacity=".5"
        d="M5 4v16m6-16v16m6-16v16m6-16v16"
      />
      <path stroke="currentColor" d="M5 15h18M5 18h18" />
      <path className="pp-material-shuttle" d="m2 12 4-3 5 2-5 3Z" />
      <path stroke="currentColor" opacity=".85" d="M8 4v16m6-16v16m6-16v16" />
    </Mark>
  );
}

function DepthFocus() {
  return (
    <Mark>
      <path
        stroke="currentColor"
        fill="none"
        strokeWidth="1.5"
        d="M2 8V3h5m14 0h5v5M2 16v5h5m14 0h5v-5"
      />
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <circle className="pp-material-focus" cx="10" cy="10" r="3.5" />
        <circle
          className="pp-material-focus pp-material-near"
          cx="17"
          cy="14"
          r="5"
        />
      </g>
    </Mark>
  );
}

function CirclingFlock() {
  return (
    <Mark>
      <g className="pp-material-flock">
        {[-75, -34, 16, 67, 120].map((angle) => (
          <g key={angle} transform={`rotate(${angle} 14 12)`}>
            <rect x="13" y="2" width="2" height="5" />
          </g>
        ))}
      </g>
    </Mark>
  );
}

export const materialSpinners = {
  FoldingRibbon: {
    title: "折り返すリボン",
    tui: "╱╲╱",
    fit: "表と裏の濃淡を残しながら、帯の先が折り目を軸に返る。",
    Glyph: FoldingRibbon,
  },
  TypeTetrahedron: {
    title: "活字四面体",
    tui: "◭ A ◮",
    fit: "三角の面に A を彫った小さな活字が、一面ずつ転がる。",
    Glyph: TypeTetrahedron,
  },
  MagneticInk: {
    title: "磁性インク",
    tui: "● ● → ●",
    fit: "二滴が細い首でつながり、一粒に溶けてから縦に離れる。",
    Glyph: MagneticInk,
  },
  Loom: {
    title: "織り機",
    tui: "╫▸╫",
    fit: "杼が経糸の表と裏をくぐり、織りかけの布の上を往復する。",
    Glyph: Loom,
  },
  DepthFocus: {
    title: "深度フォーカス",
    tui: "⌜◌◎⌟",
    fit: "ファインダーを固定し、奥の小さな輪と手前の大きな輪に交互にピントを合わせる。",
    Glyph: DepthFocus,
  },
  CirclingFlock: {
    title: "楕円目盛り",
    tui: "╵ ╱ ─",
    fit: "五本の短い目盛りが、間隔を保って楕円を巡る。",
    Glyph: CirclingFlock,
  },
} satisfies Record<
  string,
  { title: string; tui: string; fit: string; Glyph: ComponentType }
>;
