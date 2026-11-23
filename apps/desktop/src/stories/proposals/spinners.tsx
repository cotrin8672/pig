import type { ComponentType, CSSProperties, ReactNode } from "react";
import type { Proposal } from "./kit";
import { useVerb } from "./running";
import "./running.css";
import "./spinners.css";

/**
 * TUI spinners redrawn for the desktop: the same idea as the terminal frames,
 * but animated continuously (opacity/transform only) instead of swapping glyphs.
 */
const vars = (v: Record<string, string | number>) => v as CSSProperties;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function Line({
  children,
  verb: Verb,
}: {
  children: ReactNode;
  verb?: ComponentType<{ text: string }>;
}) {
  const verb = useVerb(2800);
  return (
    <p className="pp-run">
      <span className="pp-sp" aria-hidden="true">
        {children}
      </span>
      {Verb ? (
        <Verb key={verb} text={`${verb}…`} />
      ) : (
        <span key={verb} className="pp-run-verb">
          {verb}…
        </span>
      )}
    </p>
  );
}

/** ⠋⠙⠹⠸ — the 8 braille dots as real dots; a comet circles the cell. */
const BRAILLE_RING: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [1, 2],
  [1, 3],
  [0, 3],
  [0, 2],
  [0, 1],
];
function BrailleComet() {
  return (
    <span className="pp-sp-braille">
      {BRAILLE_RING.map(([x, y], i) => (
        <i
          key={`${x}-${y}`}
          style={vars({ gridColumn: x + 1, gridRow: y + 1, "--i": i })}
        />
      ))}
    </span>
  );
}

/** ⣀⣤⣶⣿ — three braille cells wide; a diagonal wave rolls through the dots. */
function BrailleWave() {
  return (
    <span className="pp-sp-wave">
      {range(24).map((i) => (
        <i key={i} style={vars({ "--x": i % 6, "--y": Math.floor(i / 6) })} />
      ))}
    </span>
  );
}

/** ⡿⣟⣯⣷ noise — each dot twinkles on its own (deterministic) clock. */
function Stardust() {
  return (
    <span className="pp-sp-dust">
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

/** | / - \ — one bar spinning freely, with fading ghosts as motion blur. */
function LineBlur() {
  return (
    <span className="pp-sp-line">
      {range(4).map((i) => (
        <i key={i} style={vars({ "--i": i, opacity: 1 - i * 0.26 })} />
      ))}
    </span>
  );
}

/** ( ●    ) — the ball squashes against the walls. */
function BouncingBall() {
  return (
    <span className="pp-sp-bounce">
      (
      <span className="pp-sp-bounce-track">
        <span className="pp-sp-bounce-ball">
          <i />
        </span>
      </span>
      )
    </span>
  );
}

/** ▐⠂       ▌ — an actual rally: the paddles follow the ball. */
function Pong() {
  return (
    <span className="pp-sp-pong">
      <i className="pp-sp-pong-paddle" />
      <span className="pp-sp-pong-ball">
        <i />
      </span>
      <i className="pp-sp-pong-paddle" />
    </span>
  );
}

/** 🌑🌒🌓🌔🌕 — light sweeps across the disc instead of 8 emoji. */
function Moon() {
  return (
    <span className="pp-sp-moon">
      <i />
    </span>
  );
}

/** 🕐🕑🕒 — a minute hand sweeps, the hour hand creeps. */
function Clock() {
  return (
    <span className="pp-sp-clock">
      <i className="pp-sp-clock-hour" />
      <i className="pp-sp-clock-minute" />
    </span>
  );
}

/** ⏳⌛ — sand drains, the glass flips over. */
function Hourglass() {
  return (
    <span className="pp-sp-glass">
      <span className="pp-sp-glass-top">
        <i />
      </span>
      <i className="pp-sp-glass-stream" />
      <span className="pp-sp-glass-bottom">
        <i />
      </span>
    </span>
  );
}

/** ◰◳◲◱ — the square corners become a real tumbling cube. */
function Cube() {
  return (
    <span className="pp-sp-cube">
      <span>
        {range(6).map((i) => (
          <i key={i} />
        ))}
      </span>
    </span>
  );
}

/** ◐◓◑◒ orbits — three electrons on tilted ellipses. */
function Atom() {
  return (
    <span className="pp-sp-atom">
      <i className="pp-sp-atom-core" />
      {[0, 60, 120].map((deg, i) => (
        <span
          key={deg}
          className="pp-sp-atom-orbit"
          style={{ transform: `rotate(${deg}deg) scaleY(0.36)` }}
        >
          <span style={{ animationDuration: `${0.9 + i * 0.25}s` }}>
            <i />
          </span>
        </span>
      ))}
    </span>
  );
}

/** ·✢✳✶✻✽ — the Claude Code star, cross-fading and turning between frames. */
const STAR = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
function Star() {
  return (
    <span className="pp-sp-star">
      {STAR.map((glyph, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: frames repeat; the index is the frame's identity
        <i key={i} style={vars({ "--i": i })}>
          {glyph}
        </i>
      ))}
    </span>
  );
}

/** Claude Code's glimmer: a bright band runs across the verb. */
function ShimmerVerb({ text }: { text: string }) {
  return (
    <span className="pp-run-verb pp-sp-shimmer">
      {Array.from(text).map((ch, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: letters repeat; the list is rebuilt per verb
        <span key={i} style={vars({ "--i": i })}>
          {ch}
        </span>
      ))}
    </span>
  );
}

/** ▰▰▱▱▱▱ — a scanner light (Knight Rider) with a trail. */
function Scanner() {
  return (
    <span className="pp-sp-scan">
      {range(6).map((i) => (
        <i key={i} />
      ))}
      {range(3).map((i) => (
        <b key={i} style={vars({ "--i": i, opacity: [1, 0.5, 0.22][i] })} />
      ))}
    </span>
  );
}

/** ᗧ···· — Pac-Man eats the dots as they arrive. */
function Pacman() {
  return (
    <span className="pp-sp-pac">
      <span className="pp-sp-pac-dots">
        <span>
          {range(8).map((i) => (
            <i key={i} />
          ))}
        </span>
      </span>
      <i className="pp-sp-pac-top" />
      <i className="pp-sp-pac-bottom" />
    </span>
  );
}

type Spinner = {
  title: string;
  tui: string;
  fit: string;
  Glyph: ComponentType;
  verb?: ComponentType<{ text: string }>;
};

const SPINNERS = {
  BrailleComet: {
    title: "点字コメット",
    tui: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
    fit: "点字1マスの8点を実際の点として描き、光る点が尾を引いて周回する。いまの点字スピナーの正統進化。",
    Glyph: BrailleComet,
  },
  BrailleWave: {
    title: "点字ウェーブ",
    tui: "⣀⣤⣶⣿⣶⣤",
    fit: "点字3マス分の点が斜めの波で明滅する。幅はあるが静かで、長い待ちでも目が疲れない。",
    Glyph: BrailleWave,
  },
  Stardust: {
    title: "星屑ノイズ",
    tui: "⡿⣟⣯⣷⣾⣽⣻⢿",
    fit: "4×4の点がそれぞれ別の周期でまたたく。規則がないので見飽きにくい。",
    Glyph: Stardust,
  },
  LineBlur: {
    title: "残像つき回転棒",
    tui: "| / - \\",
    fit: "4コマのカクカク回転を連続回転にし、残像を重ねてモーションブラー風に。最小の幅で済む。",
    Glyph: LineBlur,
  },
  BouncingBall: {
    title: "跳ねるボール",
    tui: "( ●    )",
    fit: "括弧の中をボールが往復し、壁でつぶれて跳ね返る。端末らしい括弧はそのまま残す。",
    Glyph: BouncingBall,
  },
  Pong: {
    title: "ポン",
    tui: "▐⠂       ▌",
    fit: "ボールが上下の壁で跳ね、左右のパドルが追いかけて打ち返す。待ち時間がちょっとしたラリーになる。",
    Glyph: Pong,
  },
  Moon: {
    title: "月の満ち欠け",
    tui: "🌑🌒🌓🌔🌕🌖🌗🌘",
    fit: "絵文字8枚の切替ではなく、光が円盤を横切って満ち欠けする。落ち着いた雰囲気。",
    Glyph: Moon,
  },
  Clock: {
    title: "時計",
    tui: "🕐🕑🕒🕓🕔🕕",
    fit: "長針がなめらかに回り、短針がゆっくり進む。「時間がかかっている」ことを素直に伝える。",
    Glyph: Clock,
  },
  Hourglass: {
    title: "砂時計",
    tui: "⏳⌛",
    fit: "上の砂が減って下に積もり、落ち切るとくるっと反転する。1周約2.6秒。",
    Glyph: Hourglass,
  },
  Cube: {
    title: "回転キューブ",
    tui: "◰◳◲◱",
    fit: "四隅を回るだけの記号を、本物の立方体の3D回転に。リッチUIならではの案。",
    Glyph: Cube,
  },
  Atom: {
    title: "原子",
    tui: "◐◓◑◒",
    fit: "傾いた3本の軌道を電子がそれぞれの速さで回る。にぎやかだが1文字幅に収まる。",
    Glyph: Atom,
  },
  Star: {
    title: "またたく星（Claude Code風）",
    tui: "·✢✳✶✻✽",
    fit: "Claude Code の星のコマを重ねてクロスフェードし、回りながら次の形へ変わる。",
    Glyph: Star,
  },
  StarShimmer: {
    title: "星＋きらめく動詞",
    tui: "✻ Thinking…（グリマー）",
    fit: "星に加えて、動詞の上を明るい帯が流れる。Claude Code の待ち表示に一番近い組み合わせ。",
    Glyph: Star,
    verb: ShimmerVerb,
  },
  Scanner: {
    title: "スキャナー",
    tui: "▰▰▱▱▱▱",
    fit: "6マスの上を光が残像つきで往復する（ナイトライダー）。進捗バーに似るので「進んでいる」感が出る。",
    Glyph: Scanner,
  },
  Pacman: {
    title: "パックマン",
    tui: "ᗧ····",
    fit: "流れてくる点を口をパクパクさせて食べる。遊び心は最大級。",
    Glyph: Pacman,
  },
} satisfies Record<string, Spinner>;

export const spinnerProposals = Object.fromEntries<Proposal<object>>(
  Object.entries(SPINNERS as Record<string, Spinner>).map(
    ([key, { title, tui, fit, Glyph, verb }]) => [
      key,
      {
        title,
        fit: `TUI: ${tui} — ${fit}`,
        View: () => (
          <Line verb={verb}>
            <Glyph />
          </Line>
        ),
      },
    ],
  ),
) as Record<keyof typeof SPINNERS, Proposal<object>>;

/** Every glyph enlarged next to the terminal frames it is based on. */
export function SpinnerGallery() {
  const entries = Object.entries(SPINNERS as Record<string, Spinner>);
  return (
    <div className="pp-sp-gallery">
      {entries.map(([key, { title, tui, Glyph }]) => (
        <figure key={key}>
          <span className="pp-sp pp-sp-big" aria-hidden="true">
            <Glyph />
          </span>
          <figcaption>
            <strong>{title}</strong>
            <code>{tui}</code>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
