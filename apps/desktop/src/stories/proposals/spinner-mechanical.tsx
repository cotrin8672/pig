import type { ReactNode } from "react";
import "./spinner-mechanical.css";

function machine(title: string, tui: string, fit: string, drawing: ReactNode) {
  return {
    title,
    tui,
    fit,
    Glyph: () => (
      <svg
        className="pp-machine"
        viewBox="0 0 32 22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {drawing}
      </svg>
    ),
  };
}

export const mechanicalSpinners = {
  Metronome: machine(
    "メトロノーム",
    "╱│╲",
    "おもりの付いた腕が三角の台座で拍を刻む。",
    <>
      <path d="M11 19L15 4h2l4 15z" opacity=".4" />
      <g className="pp-m-pendulum">
        <path d="M16 18V3" />
        <path d="M14.5 7h3" strokeWidth="3" />
      </g>
    </>,
  ),
  Plotter: machine(
    "ペンプロッター",
    "⌁⌁",
    "ペン先の移動に合わせて折れ線が描かれ、逆順になぞって消える。",
    <>
      <path d="M4 16l6-7 6 6 6-9 6 4" pathLength="1" className="pp-m-trace" />
      <path d="M0 0l1-4 3 1z" fill="currentColor" className="pp-m-pen" />
    </>,
  ),
  Ratchet: machine(
    "ラチェット",
    "⚙",
    "八つの歯が一段ずつ送り出され、右の爪が跳ねる。",
    <>
      <g className="pp-m-gear">
        <circle cx="15" cy="11" r="6" />
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} transform={`rotate(${i * 45} 15 11)`} d="M14 5V2h2v3" />
        ))}
      </g>
      <path className="pp-m-pawl" d="M28 4l-6 6-2-1" />
    </>,
  ),
  Piston: machine(
    "ピストン",
    "┫━",
    "ピストンヘッドがシリンダーの中を往復する。",
    <>
      <path d="M7 5h16v12H7" opacity=".45" />
      <path className="pp-m-slide" d="M9 7v8m0-4H1" strokeWidth="3" />
    </>,
  ),
  FilmFeed: machine(
    "フィルム送り",
    "▣▣",
    "窓の中でコマがひとつずつ送られる。",
    <>
      <svg x="3" y="3" width="26" height="16" viewBox="0 0 26 16">
        <g className="pp-m-film">
          {[-10, 0, 10, 20, 30].map((x) => (
            <g key={x} transform={`translate(${x} 0)`}>
              <rect x="1" y="4" width="7" height="8" />
              <path d="M3 1h2m-2 14h2" />
            </g>
          ))}
        </g>
      </svg>
    </>,
  ),
  Gauge: machine(
    "圧力計",
    "◴",
    "目盛りに沿って針が振れ、少し戻って落ち着く。",
    <>
      <path d="M5 17a11 11 0 0122 0M8 13l2 1m6-7v3m8 3-2 1" />
      <path className="pp-m-needle" d="M16 17l-6-5" />
      <circle cx="16" cy="17" r="1.4" fill="currentColor" />
    </>,
  ),
  Cradle: machine(
    "ニュートンのゆりかご",
    "●●●",
    "端の球だけが交互に跳ね上がり、衝突が反対側へ伝わる。",
    <>
      <path d="M5 3h22" opacity=".4" />
      {[10, 16, 22].map((x, i) => (
        <g key={x} className={["pp-m-left", "", "pp-m-right"][i]}>
          <path d={`M${x} 3v10`} />
          <circle cx={x} cy="15" r="2.4" fill="currentColor" />
        </g>
      ))}
    </>,
  ),
  Tape: machine(
    "テープデッキ",
    "◎─◎",
    "二つのリールが一本のテープを巻き取る。",
    <>
      <path d="M8 14l3 3h10l3-3" opacity=".5" />
      {[8, 24].map((x) => (
        <g key={x} transform={`translate(${x} 10)`}>
          <circle r="6" />
          <path className="pp-m-reel" d="M0-4v2m3.5 4-1.7-1m-5.3 1 1.7-1" />
        </g>
      ))}
    </>,
  ),
  Switchboard: machine(
    "配線パルス",
    "┈┬┈",
    "基板の直角配線に沿って短い信号が走る。",
    <>
      <path d="M2 15h9V7h9v6h10" opacity=".3" />
      <path
        className="pp-m-pulse"
        d="M2 15h9V7h9v6h10"
        pathLength="1"
        strokeWidth="3"
      />
    </>,
  ),
};
