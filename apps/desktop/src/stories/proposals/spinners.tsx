import { TurnSpinner } from "../../mainview/primitives/TurnSpinner";
import type { Proposal } from "./kit";
import { RunningLine } from "./running";
import "./spinners.css";

const SPINNERS = {
  ComputeGrid: {
    title: "演算マトリクス",
    tui: "▦",
    fit: "3×3のタイルが波紋・市松・対角線・収束と幾何パターンを切り替える。",
  },
  HexWave: {
    title: "ハニカム波",
    tui: "⬢",
    fit: "7つの六角形が中心と外周で異なる拍を刻み、うねりがずれ続ける。",
  },
  HelixPair: {
    title: "二重投影",
    tui: "⠶",
    fit: "二列の点が半周期ずれて上下し、交差する場所が左から右へ移る。",
  },
  Vacancy: {
    title: "空きマス",
    tui: "▪ ▪ ▫",
    fit: "ひとつ空いた角へ、正方形が順番に滑り込む。",
  },
  PhaseSlits: {
    title: "位相スリット",
    tui: "╱╱╱╱",
    fit: "平行線の傾きが端から順に反転し、折れ目が走る。",
  },
  OffsetArc: {
    title: "偏心弧",
    tui: "◜ ◞",
    fit: "長さの違う二本の円弧が、内と外を逆方向に巡る。",
  },
  Cradle: {
    title: "ニュートンのゆりかご",
    tui: "●●●",
    fit: "端の球だけが交互に跳ね上がり、衝突が反対側へ伝わる。",
  },
  Switchboard: {
    title: "配線パルス",
    tui: "┈┬┈",
    fit: "基板の直角配線に沿って短い信号が走る。",
  },
  Stardust: {
    title: "星屑ノイズ",
    tui: "⡿⣟⣯⣷⣾⣽⣻⢿",
    fit: "4×4の点がそれぞれ別の周期でまたたく。規則がないので見飽きにくい。",
  },
  Hourglass: {
    title: "砂時計",
    tui: "⏳⌛",
    fit: "上の砂が減って下に積もり、落ち切るとくるっと反転する。1周約2.6秒。",
  },
  Star: {
    title: "またたく星（Claude Code風）",
    tui: "·✢✳✶✻✽",
    fit: "Claude Code の星のコマを重ねてクロスフェードし、回りながら次の形へ変わる。",
  },
  Scanner: {
    title: "スキャナー",
    tui: "▰▰▱▱▱▱",
    fit: "6マスの上を光が残像つきで往復する（ナイトライダー）。進捗バーに似るので「進んでいる」感が出る。",
  },
  Lagrange: {
    title: "三体問題・ラグランジュ解",
    tui: "△",
    fit: "正三角形を保ったまま回り、楕円軌道で広がっては縮む。三つの楕円が120°ずつ重なる。",
  },
  FigureEight: {
    title: "三体問題・8の字解",
    tui: "∞",
    fit: "3つの天体が同じ8の字を追いかけ合う周期解（Chenciner–Montgomery）。軌跡は遠いほど淡く細く消える。",
  },
  Lorenz: {
    title: "ローレンツアトラクタ",
    tui: "ɞɛ",
    fit: "1点が蝶の羽のような2つの輪を気まぐれに行き来する。周期がなく見飽きにくい。",
  },
};

const variants = Object.keys(SPINNERS) as (keyof typeof SPINNERS)[];

export const spinnerProposals = Object.fromEntries<Proposal<object>>(
  variants.map((variant) => {
    const { title, tui, fit } = SPINNERS[variant];
    return [
      variant,
      {
        title,
        fit: `TUI: ${tui} — ${fit}`,
        View: () => <RunningLine variant={variant} />,
      },
    ];
  }),
) as Record<keyof typeof SPINNERS, Proposal<object>>;

export function SpinnerGallery() {
  return (
    <div className="pp-sp-gallery">
      {variants.map((variant) => (
        <figure key={variant}>
          <span className="pp-sp-big">
            <TurnSpinner variant={variant} />
          </span>
          <figcaption>
            <strong>{SPINNERS[variant].title}</strong>
            <code>{SPINNERS[variant].tui}</code>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
