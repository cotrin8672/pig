import { useEffect, useRef, useState } from "react";
import { TooltipBody, tooltipClass } from "../../mainview/Tooltip";

/**
 * Storybook-only mock: how a tooltip should move between gapless rows
 * (sidebar sessions). Production Tooltip.tsx is untouched; each lane here
 * re-implements only the row-to-row switch so the proposals can be compared.
 */
export type SwitchMode = "current" | "A" | "B" | "C" | "D";

export const switchModes: Record<SwitchMode, { name: string; note: string }> = {
  current: {
    name: "以前",
    note: "1枚を使い回し、中身と位置だけ差し替える",
  },
  A: {
    name: "A. 毎回フェード",
    note: "行が変わるたびに出現アニメーションを再生",
  },
  B: {
    name: "B. クロスフェード",
    note: "旧は元の位置で消え、新は新しい位置で出る（2枚重ね）",
  },
  C: {
    name: "C. スライド追従（採用）",
    note: "1枚が新しい行へ滑り、中身だけクロスフェード",
  },
  D: {
    name: "D. 一度閉じて開き直す",
    note: "旧はすぐ消え、移動が落ち着いて90ms後に出る",
  },
};

// Same timings as mainview/Tooltip.tsx.
const OPEN_DELAY = 500;
const WARM_FOR = 400;
const GAP = 6;
const SETTLE = 90;

const sessions = [
  ["拡張機能の再読み込みで応答が止まる", "piris · 2分前"],
  ["ツールチップの見た目を統一", "piris · 18分前"],
  ["Paneの分割と閉じるボタン", "piris · 1時間前"],
  ["使用量バーの枠線の意味", "piris · 3時間前"],
  ["履歴の取り込み（Codex / Claude Code）", "piris · 昨日"],
  ["Windowsのタイトルバー透過", "pig · 昨日"],
  ["Markdownの表の折り返し", "pig · 2日前"],
  ["検索パレットの索引作成", "pig · 3日前"],
  ["Composerの送信ボタン切り替え", "pig · 4日前"],
  ["ターミナル出力のプレビュー8行", "pig · 先週"],
] as const;

interface Tip {
  id: number;
  row: number;
  x: number;
  y: number;
  leaving?: boolean;
}

export function TooltipSwitchLane({ mode }: { mode: SwitchMode }) {
  const lane = useRef<HTMLDivElement>(null);
  const [tips, setTips] = useState<Tip[]>([]);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openRow = useRef<number | null>(null);
  const closedAt = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const fresh = (row: number, el: HTMLElement): Tip => {
    const box = el.getBoundingClientRect();
    const origin = lane.current?.getBoundingClientRect() ?? box;
    return {
      id: ++seq.current,
      row,
      x: box.right - origin.left + GAP,
      y: box.top - origin.top + box.height / 2,
    };
  };
  const fadeAll = (cur: Tip[]) => cur.map((t) => ({ ...t, leaving: true }));

  function enter(row: number, el: HTMLElement) {
    clearTimeout(timer.current);
    const next = fresh(row, el);
    if (openRow.current === null) {
      const show = () => {
        openRow.current = row;
        setTips((cur) => [...fadeAll(cur), next]);
      };
      if (Date.now() - closedAt.current < WARM_FOR) show();
      else timer.current = setTimeout(show, OPEN_DELAY);
      return;
    }
    openRow.current = row;
    if (mode === "current" || mode === "C")
      // Keep the element (same key): no replayed entry; C transitions it.
      setTips((cur) => [{ ...next, id: cur.at(-1)?.id ?? next.id }]);
    else if (mode === "A") setTips([next]);
    else if (mode === "B") setTips((cur) => [...fadeAll(cur), next]);
    else {
      setTips(fadeAll);
      timer.current = setTimeout(
        () => setTips((cur) => [...fadeAll(cur), next]),
        SETTLE,
      );
    }
  }
  function leave() {
    clearTimeout(timer.current);
    if (openRow.current !== null) closedAt.current = Date.now();
    openRow.current = null;
    // Current/A/C close instantly like production; B/D fade out.
    setTips((cur) => (mode === "B" || mode === "D" ? fadeAll(cur) : []));
  }

  return (
    <div ref={lane} className="tt-lab-lane" data-mode={mode}>
      <ul className="tt-lab-list" onPointerLeave={leave}>
        {sessions.map(([title], row) => (
          <li
            key={title}
            className="tt-lab-row"
            onPointerEnter={(event) => enter(row, event.currentTarget)}
          >
            {title}
          </li>
        ))}
      </ul>
      {tips.map((tip) => {
        const [label, description] = sessions[tip.row];
        return (
          <div
            key={tip.id}
            className={`${tooltipClass("detail")} tt-lab-tip`}
            data-side="right"
            data-leaving={tip.leaving || undefined}
            style={{ left: tip.x, top: tip.y }}
            onAnimationEnd={(event) => {
              if (event.animationName === "tt-lab-out")
                setTips((cur) => cur.filter((t) => t.id !== tip.id));
            }}
          >
            {/* C: content is keyed by row so only the text cross-fades. */}
            <div key={mode === "C" ? tip.row : 0} className="tt-lab-body">
              <TooltipBody content={{ tier: "detail", label, description }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TooltipSwitchLab() {
  return (
    <div className="tt-lab">
      {(Object.keys(switchModes) as SwitchMode[]).map((mode) => (
        <figure key={mode}>
          <figcaption>
            <strong>{switchModes[mode].name}</strong>
            <span>{switchModes[mode].note}</span>
          </figcaption>
          <TooltipSwitchLane mode={mode} />
        </figure>
      ))}
    </div>
  );
}
