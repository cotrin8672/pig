import type { ReactNode } from "react";
import "./spinner-geometric.css";

function mark(title: string, tui: string, fit: string, drawing: ReactNode) {
  return {
    title,
    tui,
    fit,
    Glyph: () => (
      <svg
        className="pp-geo"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        {drawing}
      </svg>
    ),
  };
}

export const geometricSpinners = {
  PendulumWave: mark(
    "振り子波",
    "⋮ ∿ ⋮",
    "6つの点が微妙に異なる周期で往復し、一列・波・二列と形を変え続ける。",
    <>
      {[1.2, 1.091, 1, 0.923, 0.857, 0.8].map((dur, i) => (
        <circle
          key={dur}
          cx="4"
          cy={2.5 + i * 3.8}
          r="1.55"
          fill="currentColor"
          stroke="none"
          className="pp-geo-pendulum"
          style={{ animationDuration: `${dur}s` }}
        />
      ))}
    </>,
  ),
  GridSnake: mark(
    "グリッドスネーク",
    "⠿",
    "4×4の格子を光る先頭が直角に駆け巡り、後ろほど小さく薄く消える。",
    <>
      {[4.5, 9.5, 14.5, 19.5].flatMap((y) =>
        [4.5, 9.5, 14.5, 19.5].map((x) => (
          <circle
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            r="0.85"
            fill="currentColor"
            stroke="none"
            opacity=".2"
          />
        )),
      )}
      {[0.1, 0.22, 0.38, 0.58, 0.8, 1].map((opacity, i) => {
        const size = 2.1 + i * 0.32;
        return (
          <rect
            key={opacity}
            x={-size / 2}
            y={-size / 2}
            width={size}
            height={size}
            rx="0.7"
            fill="currentColor"
            stroke="none"
            opacity={opacity}
            className="pp-geo-snake"
            style={{ animationDelay: `${-(1.975 + i * 0.085)}s` }}
          />
        );
      })}
    </>,
  ),
  SortBars: mark(
    "ソートバー",
    "▂▆▄█▅",
    "高さの違う5本のバーが隣と入れ替わり続け、逆順を経て元に戻る。",
    <>
      {[
        { h: 17, delay: 0 },
        { h: 9, delay: -3.2 },
        { h: 14, delay: -0.8 },
        { h: 6, delay: -2.4 },
        { h: 12, delay: -1.6 },
      ].map(({ h, delay }) => (
        <rect
          key={h}
          x="2.7"
          y={21 - h}
          width="2.6"
          height={h}
          rx="1.1"
          fill="currentColor"
          stroke="none"
          className="pp-geo-sort"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </>,
  ),
  Ricochet: mark(
    "ビリヤード軌跡",
    "回",
    "枠の内側を光点が10回反射して巡り、後ろに淡い尾を引く。",
    <>
      <rect x="2.5" y="2.5" width="19" height="19" rx="2.5" opacity=".24" />
      {[0.08, 0.18, 0.32, 0.52, 0.76, 1].map((opacity, i) => (
        <circle
          key={opacity}
          r={0.85 + i * 0.2}
          fill="currentColor"
          stroke="none"
          opacity={opacity}
          className="pp-geo-ricochet"
          style={{ animationDelay: `${-(2.5 + i * 0.06)}s` }}
        />
      ))}
    </>,
  ),
  ComputeGrid: mark(
    "演算マトリクス",
    "▦",
    "3×3のタイルが波紋・市松・対角線・収束と幾何パターンを切り替える。",
    <>
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
          className={`pp-geo-cell pp-geo-cell-${role}`}
        />
      ))}
    </>,
  ),
  HexWave: mark(
    "ハニカム波",
    "⬢",
    "7つの六角形が中心と外周で異なる拍を刻み、うねりがずれ続ける。",
    <>
      {[
        { cx: 12, cy: 12, cls: "pp-geo-hex-core", delay: 0 },
        ...[0, 60, 120, 180, 240, 300].map((deg, i) => ({
          cx: 12 + Math.cos((deg * Math.PI) / 180) * 6.8,
          cy: 12 + Math.sin((deg * Math.PI) / 180) * 6.8,
          cls: "pp-geo-hex-ring",
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
    </>,
  ),
  DotProof: mark(
    "点字の送り出し",
    "⠒⠧⠏",
    "右から点の列が入り、左へ送られるほど淡くなる。",
    <g className="pp-geo-paper">
      <g className="pp-geo-feed" fill="currentColor" stroke="none">
        {[0, 24].map((offset) => (
          <g key={offset} transform={`translate(${offset} 0)`}>
            {[3, 6, 4, 7, 1, 5].map((bits, col) =>
              [0, 1, 2].map(
                (row) =>
                  (bits & (1 << row)) !== 0 && (
                    <rect
                      key={`${col}-${row}`}
                      x={col * 4}
                      y={6 + row * 4}
                      width="2.8"
                      height="2.8"
                      rx=".6"
                    />
                  ),
              ),
            )}
          </g>
        ))}
      </g>
    </g>,
  ),
  SignalTrace: mark(
    "波形の書き出し",
    "⌁",
    "右端のペン先に線が生まれ、描いた波形だけが左へ流れる。",
    <>
      <g className="pp-geo-paper">
        <path
          className="pp-geo-feed"
          strokeLinejoin="round"
          d="M0 12l4-5 4 10 4-5 4 2 4-5 4 3 4-5 4 10 4-5 4 2 4-5 4 3"
        />
      </g>
      <circle
        cx="24"
        cy="12"
        r="2.2"
        fill="currentColor"
        stroke="none"
        className="pp-geo-nib"
      />
    </>,
  ),
  InfinityWake: mark(
    "八の字の残光",
    "∞",
    "一点が交差点を滑らかに抜け、後ろに薄い点の尾を引く。",
    <>
      {[1, 0.64, 0.38, 0.19, 0.08].map((opacity, i) => (
        <circle
          key={opacity}
          r={2 - i * 0.2}
          fill="currentColor"
          stroke="none"
          opacity={opacity}
          className="pp-geo-infinity"
          style={{ animationDelay: `${-1 + i * 0.075}s` }}
        />
      ))}
    </>,
  ),
  StepCascade: mark(
    "階段伝播",
    "▂▄▆",
    "三段の段差をひとつの拍が上り、通り過ぎた段から静かに沈む。",
    <>
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M${2 + i * 7} ${17 - i * 4}h6`}
          strokeWidth="2.6"
          className="pp-geo-step-beat"
          style={{ animationDelay: `${-0.9 + i * 0.18}s` }}
        />
      ))}
    </>,
  ),
  ContourEcho: mark(
    "等高線",
    "≋",
    "ゆるくうねる曲線が、少しずつ薄くなりながら奥へ重なる。",
    <>
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d="M2 13Q6 5 12 12t10-1"
          className="pp-geo-contour"
          style={{ animationDelay: `${-i * 0.8}s` }}
        />
      ))}
    </>,
  ),
  HexRoll: mark(
    "六角の歩幅",
    "⬡",
    "六角形が一つの頂点を支えに転がり、同じ道をゆっくり戻る。",
    <path
      d="m7 7 5 0 2.5 4.33L12 15.66H7l-2.5-4.33Z"
      className="pp-geo-roll"
    />,
  ),
  SlidingSeam: mark(
    "移動する継ぎ目",
    "━ ━",
    "一本の帯を二つに分ける細い余白だけが、左右を往復する。",
    <path
      d="M2 12h20"
      strokeWidth="4"
      pathLength="20"
      strokeDasharray="20 2"
      strokeDashoffset="5"
      className="pp-geo-seam"
    />,
  ),
  NodeRelay: mark(
    "節点リレー",
    "·─·",
    "折れた経路を一粒が巡る。角では立ち止まらず、次の節点に渡る。",
    <>
      <path d="M4 17V7h8v9h8V7" opacity=".32" />
      <circle
        r="2.2"
        fill="currentColor"
        stroke="none"
        className="pp-geo-relay"
      />
    </>,
  ),
  Hinge: mark(
    "蝶番",
    "└ ─ ┘",
    "一本の線が端を支点に倒れ、隣の辺と直角をつくる。",
    <>
      <path d="M3 18h10" opacity=".45" />
      <path d="M13 18V8" className="pp-geo-hinge" />
    </>,
  ),
  Guilloche: mark(
    "干渉格子",
    "╳╳",
    "重ねた二枚の縞の片方だけが傾き、交点が移動する。",
    <>
      <path d="M5 4v16m4-16v16m4-16v16m4-16v16" opacity=".35" />
      <path
        d="M5 4v16m4-16v16m4-16v16m4-16v16"
        className="pp-geo-slit"
        style={{ transformOrigin: "12px 12px" }}
      />
    </>,
  ),
  QuadFold: mark(
    "四分割",
    "▦",
    "四枚のタイルが角をそろえたまま寄り、一枚の面になる。",
    <>
      {[0, 90, 180, 270].map((a) => (
        <g key={a} transform={`rotate(${a} 12 12)`}>
          <rect
            x="5"
            y="5"
            width="7"
            height="7"
            fill="currentColor"
            stroke="none"
            className="pp-geo-tile"
          />
        </g>
      ))}
    </>,
  ),
  RadiusSwap: mark(
    "半径の交換",
    "○ ◦",
    "中心を固定した二つの円が、左右交互に大きさを交換する。",
    <>
      {[6, 18].map((x, i) => (
        <circle
          key={x}
          cx={x}
          cy="12"
          r="4.8"
          className="pp-geo-radius"
          style={{ transformOrigin: `${x}px 12px`, animationDelay: `-${i}s` }}
        />
      ))}
    </>,
  ),
  ZigDraw: mark(
    "折線の往復",
    "╱╲╱",
    "両端から中央へ折線が伸び、ひとつの山並みにつながる。",
    <>
      {[0, 180].map((a) => (
        <g key={a} transform={`rotate(${a} 12 12)`}>
          <path
            d="M2 16 7 6l5 6"
            pathLength="1"
            strokeDasharray="1"
            className="pp-geo-join"
          />
        </g>
      ))}
    </>,
  ),
  HelixPair: mark(
    "二重投影",
    "⠶",
    "二列の点が半周期ずれて上下し、交差する場所が左から右へ移る。",
    <>
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
              className="pp-geo-phase-dot"
              style={{ animationDelay: `${-row - i * 0.22}s` }}
            />
          ))}
        </g>
      ))}
    </>,
  ),
  CornerLock: mark(
    "四隅の収束",
    "⌜ ⌝",
    "枠の四隅だけが対角線に沿って集まり、小さな正方形を閉じる。",
    <>
      {[0, 90, 180, 270].map((a) => (
        <g key={a} transform={`rotate(${a} 12 12)`}>
          <path d="M12 8H8v4" className="pp-geo-tile" />
        </g>
      ))}
    </>,
  ),
  FoldedPlane: mark(
    "斜投影",
    "▱",
    "平行四辺形が一瞬だけ長方形になり、反対側へ傾く。",
    <g className="pp-geo-slit" style={{ transformOrigin: "12px 12px" }}>
      <rect x="5" y="5" width="14" height="14" />
      <path d="m5 19 14-14" opacity=".4" />
    </g>,
  ),
  BinaryDial: mark(
    "八分円",
    "◴",
    "八つの扇形のうち二つだけが、休止を挟みながら一目盛り進む。",
    <>
      <circle cx="12" cy="12" r="8" strokeWidth="4" opacity=".18" />
      <g
        className="pp-geo-orbit"
        style={{ animationTimingFunction: "steps(8)" }}
      >
        <path
          d="M12 4a8 8 0 0 1 5.66 2.34M12 20a8 8 0 0 1-5.66-2.34"
          strokeWidth="4"
        />
      </g>
    </>,
  ),
  Vacancy: mark(
    "空きマス",
    "▪ ▪ ▫",
    "ひとつ空いた角へ、正方形が順番に滑り込む。",
    <>
      {[
        [4, 4, 1, 0],
        [13, 4, 0, 1],
        [13, 13, -1, 0],
        [4, 13, 0, -1],
      ].map(([x, y, dx, dy], i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width="7"
          height="7"
          fill="currentColor"
          stroke="none"
          className="pp-geo-vacancy"
          style={
            {
              animationDelay: `${-i * 0.6}s`,
              "--dx": `${dx * 9}px`,
              "--dy": `${dy * 9}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </>,
  ),
  PhaseSlits: mark(
    "位相スリット",
    "╱╱╱╱",
    "平行線の傾きが端から順に反転し、折れ目が走る。",
    <>
      {[5, 10, 15, 20].map((x, i) => (
        <path
          key={x}
          d={`M${x} 5v14`}
          className="pp-geo-slit"
          style={{
            transformOrigin: `${x}px 12px`,
            animationDelay: `${-i * 0.18}s`,
          }}
        />
      ))}
    </>,
  ),
  OffsetArc: mark(
    "偏心弧",
    "◜ ◞",
    "長さの違う二本の円弧が、内と外を逆方向に巡る。",
    <>
      <path d="M12 3a9 9 0 1 1-9 9" className="pp-geo-orbit" />
      <path d="M12 7a5 5 0 0 0 0 10" className="pp-geo-orbit pp-geo-counter" />
    </>,
  ),
  NestedFrame: mark(
    "入れ子",
    "□ ▫",
    "外枠を固定し、内側の枠だけが対角線を越えて裏返る。",
    <>
      <rect x="3" y="3" width="18" height="18" opacity=".35" />
      <rect x="6" y="6" width="12" height="12" className="pp-geo-flip" />
    </>,
  ),
  TriangleTrace: mark(
    "三角巡回",
    "△",
    "一筆の短い線が、正三角形の角を渡り続ける。",
    <>
      <path d="M12 3 22 20H2Z" opacity=".22" />
      <path
        d="M12 3 22 20H2Z"
        pathLength="1"
        strokeDasharray=".32 .68"
        className="pp-geo-trace"
      />
    </>,
  ),
  SplitDiamond: mark(
    "分割菱形",
    "◇",
    "菱形が水平に割れ、二つの三角が逆方向にずれて戻る。",
    <>
      <path
        d="m12 4 7 7H5Z"
        fill="currentColor"
        stroke="none"
        className="pp-geo-shear"
      />
      <path
        d="m12 20-7-7h14Z"
        fill="currentColor"
        stroke="none"
        className="pp-geo-shear pp-geo-back"
      />
    </>,
  ),
  PointGrid: mark(
    "点列の転位",
    "⠿",
    "三行のドットが半拍ずつずれながら、一列ぶん横に移る。",
    <>
      {[6, 12, 18].map((y, i) => (
        <g
          key={y}
          className="pp-geo-row"
          style={{ animationDelay: `${-0.22 * i}s` }}
        >
          {[4, 10, 16].map((x) => (
            <circle
              key={x}
              cx={x}
              cy={y}
              r="1.65"
              stroke="none"
              fill="currentColor"
            />
          ))}
        </g>
      ))}
    </>,
  ),
  Tangent: mark(
    "接線",
    "⊙",
    "円に触れた短い線分が、接点を保ったまま回る。",
    <>
      <circle cx="12" cy="12" r="6" opacity=".42" />
      <path d="M5 6h14" className="pp-geo-orbit" />
    </>,
  ),
  Projection: mark(
    "直交投影",
    "＋ ×",
    "ふたつの線分が中心を共有し、長短を交替する。",
    <>
      <path d="M3 12h18" className="pp-geo-project" />
      <g transform="rotate(90 12 12)">
        <path
          d="M3 12h18"
          className="pp-geo-project"
          style={{ animationDelay: "-1s" }}
        />
      </g>
    </>,
  ),
};
