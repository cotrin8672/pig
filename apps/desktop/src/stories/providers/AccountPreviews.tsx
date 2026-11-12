import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Image,
  LoaderCircle,
  Lock,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Search,
  Settings2,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ActionsMenu } from "../../mainview/ActionsMenu";
import { ConfirmButton } from "../../mainview/ConfirmButton";
import { InlineRename } from "../../mainview/InlineRename";
import { ProviderIcon } from "../../mainview/ProviderIcon";
import { ProviderDetail } from "../../mainview/Providers";
import { useStore } from "../../mainview/store";
import {
  type Account,
  accounts,
  type Choice,
  choiceKey,
  models,
  modelsOf,
  otherProviders,
  shortLabel,
} from "./accounts-data";
import "./accounts.css";

type Row = Omit<Account, "state"> & {
  state: Account["state"] | "signing-in";
};
const subscription = new Set(["openai-codex", "anthropic"]);
const stateLabel = {
  online: "接続済み",
  "signed-out": "サインインが必要",
  "signing-in": "サインイン中",
} as const;

/** Left-side status keeps the right edge free for the row's actions. */
function Dot({ state }: { state?: Row["state"] }) {
  if (state === "signing-in")
    return <LoaderCircle size={8} className="spinner acp-dot-slot" />;
  if (!state) return <span className="acp-dot" aria-hidden="true" />;
  return (
    <span
      className="acp-dot"
      data-state={state}
      role="img"
      aria-label={stateLabel[state]}
      title={stateLabel[state]}
    />
  );
}

// Seed the real store so the detail pane is the production ProviderDetail + ProviderModels.
useStore.setState((state) => ({
  settings: { ...state.settings, language: "ja" },
  bootstrap: {
    ...state.bootstrap,
    providers: [...new Set(accounts.map((a) => a.provider))].map((id) => ({
      id,
      name: accounts.find((a) => a.provider === id)?.providerName ?? id,
      oauth: subscription.has(id) ? { subscription: true } : undefined,
      apiKey: !subscription.has(id),
      configured: true,
      stored: true,
      source: subscription.has(id) ? "OAuth" : "stored",
      extension: false,
    })),
    models: models.map((m) => ({
      provider: m.provider,
      id: m.id,
      name: m.name,
      contextWindow: m.context,
      maxTokens: 128_000,
      reasoning: m.reasoning,
      vision: m.vision,
    })),
    disabledModels: [],
  },
}));

/** Unchanged detail pane: only the title and connection reflect the selected account. */
function AccountDetail({ account }: { account: Row }) {
  const provider = useStore((s) =>
    s.bootstrap.providers.find((p) => p.id === account.provider),
  );
  if (!provider) return null;
  const online = account.state === "online";
  return (
    <ProviderDetail
      provider={{
        ...provider,
        name: account.label,
        configured: online,
        stored: online,
        source: online ? provider.source : undefined,
      }}
    />
  );
}
function AccountItem({
  account,
  selected,
  onSelect,
  onRename,
  onSignIn,
  onSignOut,
  onRemove,
}: {
  account: Row;
  selected: boolean;
  onSelect: () => void;
  onRename: (label: string) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onRemove: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="acp-row" data-nested aria-current={selected || undefined}>
      {renaming ? (
        <div className="provider-row acp-renaming">
          <Dot state={account.state} />
          <InlineRename
            value={account.label}
            label="アカウント名"
            placeholder={account.label}
            onCommit={onRename}
            onDone={() => setRenaming(false)}
          />
        </div>
      ) : (
        <button type="button" className="provider-row" onClick={onSelect}>
          <Dot state={account.state} />
          <span className="provider-row-name">{account.label}</span>
          {account.standard && <small className="provider-tag">既定</small>}
        </button>
      )}
      {!renaming && (
        <div className="acp-row-actions">
          <ActionsMenu label={`アカウントの操作: ${account.label}`}>
            {(close) => (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    setRenaming(true);
                  }}
                >
                  <Pencil size={13} />
                  名前を変更
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    if (account.state === "online") onSignOut();
                    else onSignIn();
                  }}
                >
                  {account.state === "online" ? (
                    <LogOut size={13} />
                  ) : (
                    <LogIn size={13} />
                  )}
                  {account.state === "online" ? "サインアウト" : "サインイン"}
                </button>
                {!account.standard && (
                  <ConfirmButton
                    role="menuitem"
                    className="session-menu-delete"
                    onConfirm={() => {
                      close();
                      onRemove();
                    }}
                  >
                    <Trash2 size={13} />
                    アカウントを削除
                  </ConfirmButton>
                )}
              </>
            )}
          </ActionsMenu>
        </div>
      )}
    </div>
  );
}

/** `OpenAI Codex 1`, `OpenAI Codex 2`, …: the lowest number not yet used. */
function nextLabel(providerName: string, rows: Row[]) {
  for (let n = 1; ; n++) {
    const label = `${providerName} ${n}`;
    if (!rows.some((row) => row.label === label)) return label;
  }
}

function ProviderGroup({
  provider,
  rows,
  selected,
  onSelect,
  onRows,
  onSignIn,
}: {
  provider: string;
  rows: Row[];
  selected: string;
  onSelect: (key: string) => void;
  onRows: (change: (rows: Row[]) => Row[]) => void;
  onSignIn: (account?: Row) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const first = rows[0];
  if (!first) return null;
  const nested = rows.length > 1;
  const canAdd = subscription.has(provider) && first.state === "online";
  const patch = (key: string, change: Partial<Row>) =>
    onRows((all) =>
      all.map((row) => (row.key === key ? { ...row, ...change } : row)),
    );
  return (
    <div className="acp-provider-group">
      <div
        className="acp-row"
        aria-current={(!nested && first.key === selected) || undefined}
      >
        <button
          type="button"
          className="provider-row"
          aria-expanded={nested ? expanded : undefined}
          onClick={() =>
            nested ? setExpanded(!expanded) : onSelect(first.key)
          }
        >
          {nested ? (
            <ChevronRight
              className="acp-chevron"
              size={12}
              aria-hidden="true"
            />
          ) : (
            <Dot state={first.state} />
          )}
          <ProviderIcon provider={provider} size={16} />
          <span className="provider-row-name">{first.providerName}</span>
        </button>
        {canAdd && (
          <div className="acp-row-actions" data-visible>
            <button
              type="button"
              aria-label={`${first.providerName} にアカウントを追加`}
              title="アカウントを追加"
              onClick={() => {
                setExpanded(true);
                onSignIn();
              }}
            >
              <Plus size={13} />
            </button>
          </div>
        )}
      </div>
      {nested &&
        expanded &&
        rows.map((row) => (
          <AccountItem
            key={row.key}
            account={row}
            selected={row.key === selected}
            onSelect={() => onSelect(row.key)}
            onRename={(label) => patch(row.key, { label })}
            onSignIn={() => onSignIn(row)}
            onSignOut={() => patch(row.key, { state: "signed-out" })}
            onRemove={() =>
              onRows((all) => all.filter((r) => r.key !== row.key))
            }
          />
        ))}
    </div>
  );
}

/**
 * Stand-in for the app's existing OAuth sign-in card (App.tsx OAuthLoginDialog),
 * which "+" opens unchanged. Production keeps its real prompts and links.
 */
function SignInCard({
  providerName,
  provider,
  onCancel,
  onSuccess,
}: {
  providerName: string;
  provider: string;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  // Preview only: the browser "completes" sign-in after a moment.
  const done = useRef(onSuccess);
  done.current = onSuccess;
  useEffect(() => {
    const timer = setTimeout(() => done.current(), 2400);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      className="oauth-dialog acp-signin"
      role="dialog"
      aria-label="サインイン"
    >
      <div className="dialog-heading">
        <h2>
          <ProviderIcon provider={provider} size={22} />
          {providerName} にサインイン
        </h2>
        <button type="button" aria-label="閉じる" onClick={onCancel}>
          <X size={16} />
        </button>
      </div>
      <div className="oauth-status status" role="status">
        <LoaderCircle size={14} className="spinner" /> サインイン中…
      </div>
      <div className="oauth-block">
        <p>ブラウザでサインインを完了してください。</p>
        <button type="button" className="accent-link">
          サインインページを再度開く
        </button>
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </div>
  );
}

/** Accounts nest under their Provider; "+" opens sign-in, and success adds the row. */
export function ProvidersNested({
  initial = accounts,
  adding,
}: {
  initial?: Row[];
  /** Open the sign-in card for this Provider, as right after pressing "+". */
  adding?: string;
}) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [selected, setSelected] = useState(
    initial.find((a) => !a.standard)?.key ?? initial[0]?.key ?? "",
  );
  const [signIn, setSignIn] = useState<
    { provider: string; key?: string } | undefined
  >(adding ? { provider: adding } : undefined);
  const providers = [...new Set(rows.map((a) => a.provider))];
  const current = rows.find((a) => a.key === selected) ?? rows[0];
  const target = signIn && rows.find((r) => r.provider === signIn.provider);
  return (
    <div className="acp-page">
      <h1>Providers</h1>
      <p className="muted page-description">
        サブスクリプションやAPIキーを接続します。接続済みのサブスクリプションは「+」で別のアカウントを追加できます。
      </p>
      <div className="providers-layout">
        <div className="provider-browser">
          <div className="provider-search">
            <Search size={14} />
            <input aria-label="Providerを検索" placeholder="Providerを検索" />
          </div>
          <div className="provider-groups">
            <h2 className="provider-group-title">接続済み</h2>
            {providers.map((provider) => (
              <ProviderGroup
                key={provider}
                provider={provider}
                rows={rows.filter((r) => r.provider === provider)}
                selected={selected}
                onSelect={setSelected}
                onSignIn={(account) =>
                  setSignIn({ provider, key: account?.key })
                }
                onRows={(change) =>
                  setRows((all) => {
                    const at = all.findIndex((r) => r.provider === provider);
                    const rest = all.filter((r) => r.provider !== provider);
                    const next = change(
                      all.filter((r) => r.provider === provider),
                    );
                    return [...rest.slice(0, at), ...next, ...rest.slice(at)];
                  })
                }
              />
            ))}
            <h2 className="provider-group-title">Providers</h2>
            {otherProviders.map((p) => (
              <div key={p.id} className="acp-row">
                <button type="button" className="provider-row">
                  <Dot />
                  <ProviderIcon provider={p.id} size={16} />
                  <span className="provider-row-name">{p.name}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
        {current && <AccountDetail key={current.key} account={current} />}
      </div>
      {signIn && target && (
        <SignInCard
          provider={signIn.provider}
          providerName={target.providerName}
          onCancel={() => setSignIn(undefined)}
          onSuccess={() => {
            const key = signIn.key ?? `${signIn.provider}-${Date.now()}`;
            setRows((all) => {
              if (signIn.key)
                return all.map((r) =>
                  r.key === key ? { ...r, state: "online" } : r,
                );
              const mine = all.filter((r) => r.provider === signIn.provider);
              const at = all.indexOf(mine[mine.length - 1] as Row) + 1;
              const added: Row = {
                key,
                provider: signIn.provider,
                providerName: target.providerName,
                label: nextLabel(target.providerName, mine),
                state: "online",
              };
              return [...all.slice(0, at), added, ...all.slice(at)];
            });
            setSelected(key);
            setSignIn(undefined);
          }}
        />
      )}
    </div>
  );
}

/** Today's state: one account each. The default takes "Provider 1" once a second is added. */
export const singleAccounts: Row[] = accounts
  .filter((a) => a.standard)
  .map((a) => ({ ...a, label: `${a.providerName} 1` }));

const recent: Choice[] = [
  { account: accounts[1], model: models[0] },
  { account: accounts[0], model: models[0] },
  { account: accounts[2], model: models[3] },
];

export function ModelPickerPreview({
  hasHistory = false,
  initial = recent[0],
}: {
  hasHistory?: boolean;
  initial?: Choice;
}) {
  const [current, setCurrent] = useState<Choice>(initial);
  const [source, setSource] = useState<string>("recent");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const searching = !!q;
  const sourceAccount = accounts.find((a) => a.key === source);
  const locked = (account: Account) =>
    hasHistory &&
    account.provider === current.account.provider &&
    account.key !== current.account.key;
  const visible: Choice[] = searching
    ? accounts.flatMap((account) =>
        modelsOf(account)
          .filter((m) => m.name.toLowerCase().includes(q))
          .map((model) => ({ account, model })),
      )
    : source === "recent"
      ? recent
      : sourceAccount
        ? modelsOf(sourceAccount).map((model) => ({
            account: sourceAccount,
            model,
          }))
        : [];
  const tagged = searching || source === "recent";
  const signedOut = !searching && sourceAccount?.state === "signed-out";
  const blocked = !searching && sourceAccount && locked(sourceAccount);
  return (
    <div className="acp-picker-stage">
      <div className="picker-panel model-panel acp-panel">
        <div className="model-search">
          <Search size={14} />
          <input
            aria-label="モデルを検索"
            placeholder="モデルを検索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" aria-label="モデルを管理" title="モデルを管理">
            <Settings2 size={14} />
          </button>
        </div>
        <div className="model-browser" data-has-rail>
          <nav className="model-source-rail" aria-label="モデルのソース">
            <button
              type="button"
              aria-pressed={source === "recent" && !searching}
              onClick={() => setSource("recent")}
            >
              <Clock3 size={12} />
              <span>最近使用</span>
              <small>{recent.length}</small>
            </button>
            {accounts.map((account) => (
              <button
                key={account.key}
                type="button"
                aria-pressed={source === account.key && !searching}
                data-account-state={account.state}
                data-locked={locked(account) || undefined}
                title={
                  locked(account)
                    ? "このチャットでは切り替えできません"
                    : account.state === "signed-out"
                      ? "サインインが必要"
                      : undefined
                }
                onClick={() => setSource(account.key)}
              >
                <ProviderIcon provider={account.provider} size={12} />
                <span>{account.label}</span>
                {locked(account) ? (
                  <Lock size={10} aria-label="ロック" />
                ) : (
                  <small>
                    {account.state === "online"
                      ? modelsOf(account).length
                      : "!"}
                  </small>
                )}
              </button>
            ))}
          </nav>
          <div className="model-results" role="listbox" aria-label="モデル">
            {signedOut && sourceAccount ? (
              <div className="acp-empty">
                <p>「{sourceAccount.label}」はサインインが必要です。</p>
                <button type="button" className="primary">
                  <LogIn size={13} /> サインイン
                </button>
              </div>
            ) : (
              <>
                {blocked && sourceAccount && (
                  <div className="acp-locked">
                    <p>
                      このチャットは「{current.account.label}」で開始しました。
                    </p>
                    <button type="button">
                      <SquarePen size={13} /> 「{sourceAccount.label}
                      」で新しいチャット
                    </button>
                  </div>
                )}
                {visible.map((choice, index) => {
                  const { account, model } = choice;
                  const selected = choiceKey(choice) === choiceKey(current);
                  const disabled =
                    locked(account) || account.state === "signed-out";
                  const showGroup =
                    searching &&
                    (index === 0 ||
                      visible[index - 1]?.account.key !== account.key);
                  return (
                    <div key={choiceKey(choice)}>
                      {showGroup && (
                        <div className="picker-group-title">
                          {account.label}
                        </div>
                      )}
                      <button
                        type="button"
                        className="model-option"
                        role="option"
                        aria-selected={selected}
                        aria-disabled={disabled || undefined}
                        onClick={() => !disabled && setCurrent(choice)}
                      >
                        {tagged && !searching && (
                          <ProviderIcon provider={account.provider} size={12} />
                        )}
                        <span className="model-option-name">{model.name}</span>
                        {tagged && !searching && shortLabel(account) && (
                          <small className="acp-account-chip">
                            {shortLabel(account)}
                          </small>
                        )}
                        <span className="model-capabilities">
                          {model.reasoning && (
                            <Brain size={12} aria-label="推論" />
                          )}
                          {model.vision && (
                            <Image size={12} aria-label="画像" />
                          )}
                          <small>{Math.round(model.context / 1000)}k</small>
                        </span>
                        <span className="model-selected-mark">
                          {selected && <Check size={13} />}
                        </span>
                      </button>
                    </div>
                  );
                })}
                {!visible.length && (
                  <p className="picker-empty">一致するモデルがありません</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="composer acp-composer">
        <div className="acp-composer-text">メッセージを入力…</div>
        <div className="composer-toolbar">
          <button
            type="button"
            className="picker-trigger acp-trigger"
            aria-label={`モデル: ${current.model.name}, ${current.account.label}`}
          >
            {shortLabel(current.account) && (
              <span className="acp-trigger-account">
                <ProviderIcon provider={current.account.provider} size={11} />
                {shortLabel(current.account)}
              </span>
            )}
            <span className="picker-model-label">{current.model.name}</span>
            <span className="picker-effort-label">Medium</span>
            <ChevronDown size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
