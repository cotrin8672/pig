import { useEffect, useState } from "react";
import type { Proposal } from "./kit";
import "./running.css";

type Content = Record<string, Proposal<object>>;

/** Design candidates only; these words are not used by the app. */
const VERBS = [
  "考え中",
  "思案中",
  "検討中",
  "組み立て中",
  "コードを読み中",
  "方針を練り中",
  "手を動かし中",
  "確かめ中",
  "悩み中",
  "ひらめき中",
  "そろえ中",
  "つつき中",
  "鼻先で探り中",
  "土を掘り中",
];

function shuffle(list: string[]) {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

/**
 * Walks a shuffled copy of the pool, so a run never shows a word twice before
 * every other word has had a turn.
 */
export function useVerb(intervalMs: number) {
  const [verb, setVerb] = useState(VERBS[0]);
  useEffect(() => {
    let queue = shuffle(VERBS);
    let index = 0;
    setVerb(queue[0]);
    const timer = setInterval(() => {
      index += 1;
      if (index >= queue.length) {
        queue = shuffle(VERBS);
        index = 0;
      }
      setVerb(queue[index]);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return verb;
}

function useFrame(frames: string[], ms: number) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setFrame((n) => (n + 1) % frames.length),
      ms,
    );
    return () => clearInterval(timer);
  }, [frames, ms]);
  return frames[frame];
}

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** 01 — Claude Code 方式。点字スピナー＋毎回変わる動詞。 */
function RunSpinner() {
  const verb = useVerb(2600);
  const frame = useFrame(BRAILLE, 90);
  return (
    <p className="pp-run">
      <span className="pp-run-glyph" aria-hidden="true">
        {frame}
      </span>
      <span key={verb} className="pp-run-verb">
        {verb}…
      </span>
    </p>
  );
}

/** 02 — 3つの点が波打つ。動きは小さいが目が止まる。 */
function RunDots() {
  const verb = useVerb(3200);
  return (
    <p className="pp-run">
      <span className="pp-run-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span key={verb} className="pp-run-verb">
        {verb}…
      </span>
    </p>
  );
}

/** 03 — 動詞を1文字ずつ打っては消す。待ち時間そのものが見どころになる。 */
function RunTyping() {
  const [word, setWord] = useState(0);
  const [shown, setShown] = useState(0);
  const [erasing, setErasing] = useState(false);
  const full = VERBS[word];
  useEffect(() => {
    const complete = shown === full.length;
    const delay = !complete ? 62 : erasing ? 26 : 1100;
    const timer = setTimeout(() => {
      if (!complete) setShown(shown + 1);
      else if (!erasing) setErasing(true);
      else if (shown > 0) setShown(shown - 1);
      else {
        setErasing(false);
        setWord((n) => (n + 1) % VERBS.length);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [shown, erasing, full]);
  return (
    <p className="pp-run">
      <span className="pp-run-typed">{full.slice(0, shown)}</span>
      <span className="pp-run-caret" aria-hidden="true" />
    </p>
  );
}

/** 04 — 動詞がスロットのように下から回り込む。スピナーなし。 */
function RunReel() {
  const verb = useVerb(2200);
  return (
    <p className="pp-run">
      <span className="pp-run-reel">
        <span key={verb} className="pp-run-reel-word">
          {verb}…
        </span>
      </span>
    </p>
  );
}

/** 05 — 軌道に光が回る。静かに、上品に。 */
function RunOrbit() {
  const verb = useVerb(3000);
  return (
    <p className="pp-run">
      <span className="pp-run-ring" aria-hidden="true" />
      <span key={verb} className="pp-run-verb pp-run-verb-blur">
        {verb}…
      </span>
    </p>
  );
}

/** 06 — 小さな信号バー。ターミナルの実行中表示と雰囲気が揃う。 */
function RunBars() {
  const verb = useVerb(2800);
  return (
    <p className="pp-run">
      <span className="pp-run-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span key={verb} className="pp-run-verb">
        {verb}…
      </span>
    </p>
  );
}

const MIX = [RunSpinner, RunDots, RunOrbit, RunBars];

/** 07 — 応答ごとに上の演出を1つ選ぶ。「毎回違う」を仕組みにする。 */
function RunMixed() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setIndex((n) => (n + 1) % MIX.length),
      5200,
    );
    return () => clearInterval(timer);
  }, []);
  const View = MIX[index];
  return <View />;
}

export const runningProposals = {
  Spinner: {
    title: "点字スピナー＋動詞",
    fit: "Claude Code に一番近い。80msで回る点字と、2.6秒ごとに変わる動詞。動きが細いので本文の邪魔をしない。",
    View: RunSpinner,
  },
  Dots: {
    title: "波打つ3点",
    fit: "点が順に跳ねるだけの軽い動き。スピナーの回転が落ち着かない人向け。",
    View: RunDots,
  },
  Typing: {
    title: "打っては消す",
    fit: "動詞を1文字ずつ打ち、少し置いて消す。遊び心は最大。長い待ちでは文字が落ち着かないので、短い応答向け。",
    View: RunTyping,
  },
  Reel: {
    title: "スロットリール",
    fit: "スピナーを置かず、動詞だけが下から回り込む。文字の動き自体が「動いている」合図になる。",
    View: RunReel,
  },
  Orbit: {
    title: "軌道の光",
    fit: "小さな環を光が回り、動詞はぼかして入れ替わる。静かで上品。集中を切らしたくない時向け。",
    View: RunOrbit,
  },
  Bars: {
    title: "信号バー",
    fit: "4本のバーが脈打つ。ミニターミナルの実行中の点と同じ調子で、画面全体の雰囲気に馴染む。",
    View: RunBars,
  },
  Mixed: {
    title: "毎回ちがう（自動で切替）",
    fit: "応答ごとに演出を1つ抽選する案。5.2秒ごとに切替を表示。動詞の入れ替えと合わせて、同じ待ちが二度と見えない。",
    View: RunMixed,
  },
} satisfies Content;
