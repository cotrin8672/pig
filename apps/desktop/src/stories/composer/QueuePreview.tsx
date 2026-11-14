import { ArrowUp, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { MessageQueue } from "../../mainview/MessageQueue";
import { unfoldPastes } from "../../shared/paste";
import type { DraftContent } from "../../shared/runtime-contract";
import "../../mainview/composer.css";
import "./queue.css";

type Item = { id: string; content: DraftContent };
export type QueueArgs = { count: number; sending: boolean };
const content = (
  text: string,
  extra: Partial<DraftContent> = {},
): DraftContent => ({ text, pastes: [], images: [], ...extra });
const stackTrace = [
  "TypeError: Cannot read properties of undefined (reading 'farewell')",
  "    at farewell (src/i18n/greeting.ts:18:44)",
  "    at Header (src/components/Header.tsx:9:20)",
  ...Array.from(
    { length: 9 },
    (_, i) => `    at renderWithHooks (react-dom.js:${1200 + i}:18)`,
  ),
].join("\n");
const fixtures: Item[] = [
  {
    id: "q1",
    content: content(
      "あと README の使用例も新しいシグネチャに合わせて直しておいて",
    ),
  },
  {
    id: "q2",
    content: content(
      "ブラウザでこのエラーが出た。fr を選んだ時だけ起きる\n[paste #1 +12 lines]",
      {
        pastes: [
          { id: "p1", marker: "[paste #1 +12 lines]", text: stackTrace },
        ],
        images: [
          {
            id: "i1",
            image: {
              type: "image",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
              mimeType: "image/png",
            },
          },
        ],
      },
    ),
  },
  {
    id: "q3",
    content: content("複数形はとりあえず messages で。", {
      annotations: [
        {
          id: "a1",
          quote: "複数形のキー plural.other の訳がまだありません。",
          comment: "messages で",
        },
      ],
    }),
  },
  { id: "q4", content: content("終わったらコミットもお願い") },
  {
    id: "q5",
    content: content("この仕様書に沿ってるかも確認して", {
      files: [{ id: "f1", name: "i18n-spec.md", path: "/docs/i18n-spec.md" }],
    }),
  },
  { id: "q6", content: content("ありがとう！") },
];

/** Working composer around the shipped queue, not a separate queue implementation. */
export function QueuePreview({ count, sending }: QueueArgs) {
  const [state, setState] = useState({
    count,
    items: fixtures.slice(0, count),
  });
  const [draft, setDraft] = useState("");
  const serial = useRef(0);
  if (state.count !== count)
    setState({ count, items: fixtures.slice(0, count) });
  const items = state.items;
  const setItems = (next: Item[]) => setState({ count, items: next });
  const take = (id: string) => {
    if (sending && items[0]?.id === id) return;
    const item = items.find((item) => item.id === id);
    setItems(items.filter((item) => item.id !== id));
    return item;
  };
  const send = () => {
    if (!draft.trim()) return;
    serial.current += 1;
    setItems([
      ...items,
      { id: `new${serial.current}`, content: content(draft.trim()) },
    ]);
    setDraft("");
  };
  return (
    <div className="queue-preview">
      <div className="queue-preview-response">
        <LoaderCircle size={12} className="spinner" aria-hidden="true" />
        テストを実行しています…
        <button
          type="button"
          onClick={() => setItems(fixtures.slice(0, count))}
        >
          キューを戻す
        </button>
      </div>
      <MessageQueue
        items={items.map((item, index) => ({
          ...item,
          locked: sending && index === 0,
        }))}
        onEdit={(id) => {
          const item = take(id);
          if (item)
            setDraft(unfoldPastes(item.content.text, item.content.pastes));
        }}
        onDelete={(id) => void take(id)}
        onMove={(ids) => {
          setItems(ids.flatMap((id) => items.filter((item) => item.id === id)));
        }}
        onSteer={(id) => void take(id)}
      />
      <div className="composer">
        <textarea
          aria-label="メッセージ"
          rows={2}
          value={draft}
          placeholder="次のメッセージ（送ると応答後に届きます）"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            send();
          }}
        />
        <div className="composer-toolbar">
          <div className="send-controls">
            <button
              type="button"
              className="send-button"
              aria-label="キューに追加"
              disabled={!draft.trim()}
              onClick={send}
            >
              <ArrowUp size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
