// biome-ignore-all lint/suspicious/noArrayIndexKey: Queue previews keep their order.
import {
  Check,
  FileText,
  Image,
  ListEnd,
  LoaderCircle,
  MessageSquareQuote,
  Paperclip,
  PencilLine,
  X,
} from "lucide-react";
import { type ComponentType, useState } from "react";
import { MessageQueue } from "../../mainview/MessageQueue";
import { unfoldPastes } from "../../shared/paste";
import type { DraftContent } from "../../shared/runtime-contract";
import type { Proposal } from "./kit";

type Item = { id: string; content: DraftContent };
export type QueueArgs = { count?: number; sending?: boolean };
type QueueProps = {
  items: Item[];
  /** The first item has left the queue for the agent; it can no longer be withdrawn. */
  sending: boolean;
  onEdit(id: string): void;
  onDelete(id: string): void;
};

const pixel = {
  type: "image" as const,
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  mimeType: "image/png",
};
const content = (
  text: string,
  extra: Partial<DraftContent> = {},
): DraftContent => ({
  text,
  pastes: [],
  images: [],
  ...extra,
});
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
        images: [{ id: "i1", image: pixel }],
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

/** Paste markers become a chip; the user wrote the sentence, not the stack trace. */
function describe(c: DraftContent) {
  const pastes = c.pastes.filter((p) => c.text.includes(p.marker));
  const text = pastes.reduce((t, p) => t.replace(p.marker, ""), c.text).trim();
  return {
    text,
    full: unfoldPastes(c.text, c.pastes),
    pastes: pastes.map((p) => p.text.split("\n").length),
    images: c.images.length,
    files: (c.files ?? []).map((f) => f.name),
    notes: c.annotations?.length ?? 0,
  };
}
function Extras({
  content: c,
  compact,
}: {
  content: DraftContent;
  compact?: boolean;
}) {
  const d = describe(c);
  const count = d.pastes.length + d.images + d.files.length + d.notes;
  if (!count) return null;
  if (compact)
    return (
      <span className="pp-q-extras-compact" title={d.full}>
        <Paperclip size={11} aria-hidden="true" />
        {count}
      </span>
    );
  return (
    <span className="pp-q-extras">
      {d.pastes.map((lines, i) => (
        <span key={`p${i}`}>
          <FileText size={11} aria-hidden="true" />
          貼り付け {lines} 行
        </span>
      ))}
      {d.images > 0 && (
        <span>
          <Image size={11} aria-hidden="true" />
          画像 {d.images}
        </span>
      )}
      {d.files.map((name) => (
        <span key={name}>
          <Paperclip size={11} aria-hidden="true" />
          {name}
        </span>
      ))}
      {d.notes > 0 && (
        <span>
          <MessageSquareQuote size={11} aria-hidden="true" />
          注釈 {d.notes}
        </span>
      )}
    </span>
  );
}
function Actions({
  id,
  locked,
  onEdit,
  onDelete,
}: { id: string; locked: boolean } & Pick<QueueProps, "onEdit" | "onDelete">) {
  if (locked)
    return (
      <span className="pp-q-sending">
        <LoaderCircle size={12} className="spinner" aria-hidden="true" />
        送信中
      </span>
    );
  return (
    <span className="pp-q-actions">
      <button
        type="button"
        aria-label="入力欄に戻して編集"
        title="入力欄に戻して編集"
        onClick={() => onEdit(id)}
      >
        <PencilLine size={13} />
      </button>
      <button
        type="button"
        aria-label="キューから削除"
        title="キューから削除"
        onClick={() => onDelete(id)}
      >
        <X size={13} />
      </button>
    </span>
  );
}

/* ---------------- proposals ---------------- */

function NextUp({ items, sending, onEdit, onDelete }: QueueProps) {
  const [open, setOpen] = useState(false);
  const [next, ...rest] = items;
  if (!next) return null;
  return (
    <div className="pp-q-next">
      <header>
        <ListEnd size={13} aria-hidden="true" />
        {sending ? "送信しています" : "この応答のあとに送信"}
        {rest.length > 0 && (
          <button
            type="button"
            className="pp-link"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "閉じる" : `ほか ${rest.length} 件`}
          </button>
        )}
      </header>
      <article>
        <p className="pp-q-clamp">{describe(next.content).text}</p>
        <Extras content={next.content} />
        <Actions
          id={next.id}
          locked={sending}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </article>
      {open && (
        <ol>
          {rest.map((item, i) => (
            <li key={item.id}>
              <span className="pp-lineno">{i + 2}</span>
              <p title={describe(item.content).full}>
                {describe(item.content).text}
              </p>
              <Extras content={item.content} compact />
              <Actions
                id={item.id}
                locked={false}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Tabs({ items, sending, onEdit, onDelete }: QueueProps) {
  if (!items.length) return null;
  return (
    <div className="pp-q-tabs">
      <span className="pp-q-tab pp-q-tab-current" aria-current="true">
        入力中
      </span>
      {items.map((item, i) => {
        const locked = sending && i === 0;
        const d = describe(item.content);
        return (
          <span
            key={item.id}
            className={`pp-q-tab${locked ? " pp-q-tab-locked" : ""}`}
            title={d.full}
          >
            <button
              type="button"
              disabled={locked}
              onClick={() => onEdit(item.id)}
            >
              {locked ? (
                <LoaderCircle
                  size={11}
                  className="spinner"
                  aria-hidden="true"
                />
              ) : (
                <span className="pp-lineno">{i + 1}</span>
              )}
              <span className="pp-q-tab-text">{d.text}</span>
              <Extras content={item.content} compact />
            </button>
            {!locked && (
              <button
                type="button"
                aria-label="キューから削除"
                onClick={() => onDelete(item.id)}
              >
                <X size={11} />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

function Timeline({ items, sending, onEdit, onDelete }: QueueProps) {
  if (!items.length) return null;
  return (
    <ol className="pp-q-timeline">
      <li className="pp-q-node-response">
        <span className="pp-q-dot">
          {sending ? (
            <Check size={11} />
          ) : (
            <LoaderCircle size={11} className="spinner" />
          )}
        </span>
        <span className="pp-faint">
          {sending ? "応答が終わりました" : "エージェントが応答中"}
        </span>
      </li>
      {items.map((item, i) => (
        <li
          key={item.id}
          className={sending && i === 0 ? "pp-q-node-sending" : undefined}
        >
          <span className="pp-q-dot">{i + 1}</span>
          <div>
            <small>
              {i === 0
                ? sending
                  ? "送信中"
                  : "応答が終わったら送信"
                : "その次"}
            </small>
            <p className="pp-q-clamp">{describe(item.content).text}</p>
            <Extras content={item.content} />
          </div>
          <Actions
            id={item.id}
            locked={sending && i === 0}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </li>
      ))}
    </ol>
  );
}

function Chips({ items, sending, onEdit, onDelete }: QueueProps) {
  if (!items.length) return null;
  return (
    <div className="pp-q-chips">
      <span className="pp-faint">
        <ListEnd size={12} aria-hidden="true" /> 待機 {items.length}
      </span>
      {items.map((item, i) => {
        const locked = sending && i === 0;
        const d = describe(item.content);
        return (
          <span
            key={item.id}
            className={`pp-q-chip${locked ? " pp-q-chip-locked" : ""}`}
            title={d.full}
          >
            <button
              type="button"
              disabled={locked}
              aria-label={`編集: ${d.text}`}
              onClick={() => onEdit(item.id)}
            >
              {locked && (
                <LoaderCircle
                  size={11}
                  className="spinner"
                  aria-hidden="true"
                />
              )}
              <span>{d.text}</span>
              <Extras content={item.content} compact />
            </button>
            {!locked && (
              <button
                type="button"
                aria-label="キューから削除"
                onClick={() => onDelete(item.id)}
              >
                <X size={11} />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

/* ---------------- stage ---------------- */

/** Every preview sits on a working composer: edit moves the message back, delete drops it. */
function staged(View: ComponentType<QueueProps>) {
  return function Stage({ count = 3, sending = false }: QueueArgs) {
    const [state, setState] = useState({
      count,
      items: fixtures.slice(0, count),
    });
    const [draft, setDraft] = useState("");
    const [notice, setNotice] = useState<string>();
    if (state.count !== count)
      setState({ count, items: fixtures.slice(0, count) });
    const items = state.items;
    const take = (id: string) => {
      if (sending && items[0]?.id === id) {
        setNotice("このメッセージはすでに送信を開始しています。");
        return;
      }
      setNotice(undefined);
      setState({ count, items: items.filter((item) => item.id !== id) });
      return items.find((item) => item.id === id);
    };
    return (
      <div className="pp-q-stage">
        <p className="pp-q-response pp-faint">
          {sending ? (
            "…以上で完了です。"
          ) : (
            <>
              <LoaderCircle size={12} className="spinner" aria-hidden="true" />{" "}
              テストを実行しています…
            </>
          )}
        </p>
        <View
          items={items}
          sending={sending}
          onEdit={(id) => {
            const item = take(id);
            if (item)
              setDraft(unfoldPastes(item.content.text, item.content.pastes));
          }}
          onDelete={(id) => void take(id)}
        />
        <div className="composer">
          <textarea
            aria-label="メッセージ"
            rows={2}
            value={draft}
            placeholder="次のメッセージ（送ると応答後に届きます）"
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        {notice && (
          <p role="alert" className="pp-error-text">
            {notice}
          </p>
        )}
        {!items.length && (
          <button
            type="button"
            className="pp-link"
            onClick={() => setState({ count, items: fixtures.slice(0, count) })}
          >
            キューを戻す
          </button>
        )}
      </div>
    );
  };
}

export const QueueDefault = staged(({ items, onEdit, onDelete }) => (
  <MessageQueue items={items} onEdit={onEdit} onDelete={onDelete} />
));
export const queueProposals = {
  NextUp: {
    title: "次の一通",
    fit: "待機はたいてい 1〜2 件。次に届く一通だけを全文で見せて入力欄の上を空け、残りは件数にまとめる。",
    View: staged(NextUp),
  },
  Tabs: {
    title: "入力欄のタブ",
    fit: "応答を待つ間に書き直すことが多い使い方。待機中のメッセージを下書きのタブとして入力欄にくっつけ、押すと入力欄に戻る。",
    View: staged(Tabs),
  },
  Timeline: {
    title: "届く順番",
    fit: "何件も積んで順番が大事な場面。いま走っている応答を先頭に置き、それぞれがいつ届くかを線でつなぐ。",
    View: staged(Timeline),
  },
  Chips: {
    title: "一行のチップ",
    fit: "「コミットもお願い」のような短い追伸を積む場面。高さを一行に固定し、全文はホバーで出す。",
    View: staged(Chips),
  },
} satisfies Record<string, Proposal<QueueArgs>>;
