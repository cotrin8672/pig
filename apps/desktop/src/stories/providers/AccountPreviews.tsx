import {
  Brain,
  Check,
  ChevronDown,
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
import { useId, useState } from "react";
import { ProviderIcon } from "../../mainview/ProviderIcon";
import {
  type Account,
  accounts,
  accountsOf,
  type Choice,
  choiceKey,
  models,
  modelsOf,
  needsAccountLabel,
  otherProviders,
  shortLabel,
} from "./accounts-data";
import "./accounts.css";

function Status({ account }: { account: Account }) {
  return (
    <span className="provider-status" data-state={account.state === "online" ? "online" : "offline"} role="status">
      <span>{account.state === "online" ? "接続済み" : "サインインが必要"}</span>
    </span>
  );
}

function AccountRow({
  account,
  selected,
  nested,
  onSelect,
}: {
  account: Account;
  selected: boolean;
  nested?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="provider-row"
      data-nested={nested || undefined}
      aria-current={selected || undefined}
      onClick={onSelect}
    >
      {!nested && <ProviderIcon provider={account.provider} size={16} />}
      <span className="provider-row-name">{account.label}</span>
      {account.standard && needsAccountLabel(account) && <small className="provider-tag">既定</small>}
      {account.state === "online" ? (
        <span className="provider-dot" role="img" aria-label="接続済み" />
      ) : (
        <small className="acp-warning-tag">要サインイン</small>
      )}
    </button>
  );
}

function AccountDetail({ account, onAdd }: { account: Account; onAdd: () => void }) {
  const siblings = accountsOf(account.provider);
  return (
    <section className="provider-detail" aria-label={account.label}>
      <header className="provider-detail-header">
        <ProviderIcon provider={account.provider} size={28} />
        <div>
          <h2 className="acp-title">
            {account.label}
            <button type="button" aria-label="表示名を変更" title="表示名を変更">
              <Pencil size={12} />
            </button>
          </h2>
          <code>
            {account.providerName} · {account.standard ? "pi 標準の認証（CLIと共有）" : "pig のみ"}
          </code>
        </div>
        <Status account={account} />
        <div className="inline-actions">
          {account.state === "online" ? (
            <button type="button">
              <LogOut size={14} /> サインアウト
            </button>
          ) : (
            <button type="button" className="primary">
              <LogIn size={14} /> サインイン
            </button>
          )}
          {!account.standard && (
            <button type="button" className="acp-danger" aria-label="アカウントを削除" title="アカウントを削除">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </header>
      <section className="acp-section">
        <div className="provider-section-heading">
          <h3>{account.providerName} のアカウント</h3>
          <small>{siblings.length}</small>
          <button type="button" className="acp-add-inline" onClick={onAdd}>
            <Plus size={13} /> アカウントを追加
          </button>
        </div>
        <ul className="acp-siblings">
          {siblings.map((sibling) => (
            <li key={sibling.key} data-current={sibling.key === account.key || undefined}>
              <span>{sibling.label}</span>
              {sibling.standard && <small>既定 · CLIと共有</small>}
              <small data-state={sibling.state}>{sibling.state === "online" ? "接続済み" : "要サインイン"}</small>
            </li>
          ))}
        </ul>
      </section>
      <section className="acp-section">
        <div className="provider-section-heading">
          <h3>モデル</h3>
          <small>{modelsOf(account).length}</small>
        </div>
        <p className="provider-hint muted">表示・推論レベルの設定は {account.providerName} の全アカウントで共通です。</p>
        <ul className="acp-model-list">
          {modelsOf(account).map((model) => (
            <li key={model.id}>
              <span>{model.name}</span>
              <code>{model.id}</code>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

/** Proposal A: each account is a sibling row, matching the picker's pseudo-Providers. */
export function ProvidersFlat({ onAdd }: { onAdd?: (account: Account) => void }) {
  const [selected, setSelected] = useState("codex-work");
  const current = accounts.find((a) => a.key === selected) ?? accounts[0];
  return (
    <ProvidersFrame current={current} onAdd={() => onAdd?.(current)}>
      <h2 className="provider-group-title">接続済み</h2>
      {accounts.map((account) => (
        <AccountRow key={account.key} account={account} selected={account.key === selected} onSelect={() => setSelected(account.key)} />
      ))}
      <OtherProviders />
    </ProvidersFrame>
  );
}

/** Proposal B: accounts nest under their Provider; the Provider row stays unique. */
export function ProvidersNested({ onAdd }: { onAdd?: (account: Account) => void }) {
  const [selected, setSelected] = useState("codex-work");
  const current = accounts.find((a) => a.key === selected) ?? accounts[0];
  const providers = [...new Set(accounts.map((a) => a.provider))];
  return (
    <ProvidersFrame current={current} onAdd={() => onAdd?.(current)}>
      <h2 className="provider-group-title">接続済み</h2>
      {providers.map((provider) => {
        const group = accountsOf(provider);
        const first = group[0];
        if (!first) return null;
        if (group.length === 1)
          return <AccountRow key={provider} account={first} selected={first.key === selected} onSelect={() => setSelected(first.key)} />;
        return (
          <div key={provider} className="acp-provider-group">
            <div className="acp-provider-heading">
              <ProviderIcon provider={provider} size={16} />
              <span>{first.providerName}</span>
              <small>{group.length}</small>
            </div>
            {group.map((account) => (
              <AccountRow key={account.key} nested account={account} selected={account.key === selected} onSelect={() => setSelected(account.key)} />
            ))}
          </div>
        );
      })}
      <OtherProviders />
    </ProvidersFrame>
  );
}

function OtherProviders() {
  return (
    <>
      <h2 className="provider-group-title">Providers</h2>
      {otherProviders.map((p) => (
        <button key={p.id} type="button" className="provider-row">
          <ProviderIcon provider={p.id} size={16} />
          <span className="provider-row-name">{p.name}</span>
        </button>
      ))}
    </>
  );
}

function ProvidersFrame({ current, onAdd, children }: { current: Account; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="acp-page">
      <h1>Providers</h1>
      <p className="muted page-description">サブスクリプションやAPIキーを接続します。同じProviderに仕事用・個人用など複数のアカウントを登録できます。</p>
      <div className="providers-layout">
        <div className="provider-browser">
          <div className="provider-search">
            <Search size={14} />
            <input aria-label="Providerを検索" placeholder="Providerを検索" />
          </div>
          <div className="provider-groups">{children}</div>
        </div>
        <AccountDetail key={current.key} account={current} onAdd={onAdd} />
      </div>
    </div>
  );
}

export type AddStep = "name" | "signing-in" | "error";
/** Naming first: the browser may already be signed in to the other account, so the name must say which one was intended. */
export function AddAccountDialog({ step = "name", provider = "openai-codex" }: { step?: AddStep; provider?: string }) {
  const providerName = accountsOf(provider)[0]?.providerName ?? provider;
  const prefix = provider === "anthropic" ? "Claude" : "Codex";
  const [name, setName] = useState(`${prefix} Work`);
  const id = useId();
  const taken = accounts.some((a) => a.provider === provider && a.label === name.trim());
  return (
    <div className="oauth-dialog acp-dialog" role="dialog" aria-labelledby={id}>
      <div className="dialog-heading">
        <h2 id={id}>
          <ProviderIcon provider={provider} size={18} /> {providerName} のアカウントを追加
        </h2>
        <button type="button" aria-label="閉じる">
          <X size={16} />
        </button>
      </div>
      {step === "name" ? (
        <>
          <label className="acp-field">
            <span>表示名</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </label>
          <div className="acp-presets" role="group" aria-label="候補">
            {["Work", "Private", "Client"].map((suffix) => (
              <button key={suffix} type="button" aria-pressed={name === `${prefix} ${suffix}`} onClick={() => setName(`${prefix} ${suffix}`)}>
                {prefix} {suffix}
              </button>
            ))}
          </div>
          <p className="oauth-status">
            モデル選択に「{name.trim() || "…"}」として表示されます。サインインするアカウントがブラウザで正しいか確認してください。
          </p>
          {taken && <p className="acp-inline-error">同じ名前のアカウントがあります。</p>}
          <div className="dialog-actions acp-actions">
            <button type="button">キャンセル</button>
            <button type="button" className="primary" disabled={!name.trim() || taken}>
              <LogIn size={14} /> ブラウザでサインイン
            </button>
          </div>
        </>
      ) : step === "signing-in" ? (
        <>
          <div className="oauth-block">
            <p>
              <LoaderCircle size={13} className="spinner" /> 「{name}」のサインインをブラウザで続けてください。
            </p>
            <p className="muted">別のアカウントで自動的にサインインされた場合は、ブラウザでアカウントを切り替えてから承認します。</p>
          </div>
          <div className="dialog-actions">
            <button type="button">キャンセル</button>
          </div>
        </>
      ) : (
        <>
          <div className="oauth-error" role="alert">
            サインインがキャンセルされました。「{name}」は未接続のまま保存されています。
          </div>
          <div className="dialog-actions acp-actions">
            <button type="button">あとで</button>
            <button type="button" className="primary">
              <LogIn size={14} /> もう一度サインイン
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const recent: Choice[] = [
  { account: accounts[1]!, model: models[0]! },
  { account: accounts[0]!, model: models[0]! },
  { account: accounts[2]!, model: models[3]! },
];

export function ModelPickerPreview({ hasHistory = false, initial = recent[0]! }: { hasHistory?: boolean; initial?: Choice }) {
  const [current, setCurrent] = useState<Choice>(initial);
  const [source, setSource] = useState<string>("recent");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const searching = !!q;
  const sourceAccount = accounts.find((a) => a.key === source);
  const locked = (account: Account) => hasHistory && account.provider === current.account.provider && account.key !== current.account.key;
  const visible: Choice[] = searching
    ? accounts.flatMap((account) => modelsOf(account).filter((m) => m.name.toLowerCase().includes(q)).map((model) => ({ account, model })))
    : source === "recent"
      ? recent
      : sourceAccount
        ? modelsOf(sourceAccount).map((model) => ({ account: sourceAccount, model }))
        : [];
  const tagged = searching || source === "recent";
  const signedOut = !searching && sourceAccount?.state === "signed-out";
  const blocked = !searching && sourceAccount && locked(sourceAccount);
  return (
    <div className="acp-picker-stage">
      <div className="picker-panel model-panel acp-panel">
        <div className="model-search">
          <Search size={14} />
          <input aria-label="モデルを検索" placeholder="モデルを検索" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="button" aria-label="モデルを管理" title="モデルを管理">
            <Settings2 size={14} />
          </button>
        </div>
        <div className="model-browser" data-has-rail>
          <nav className="model-source-rail" aria-label="モデルのソース">
            <button type="button" aria-pressed={source === "recent" && !searching} onClick={() => setSource("recent")}>
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
                title={locked(account) ? "このチャットでは切り替えできません" : account.state === "signed-out" ? "サインインが必要" : undefined}
                onClick={() => setSource(account.key)}
              >
                <ProviderIcon provider={account.provider} size={12} />
                <span>{account.label}</span>
                {locked(account) ? <Lock size={10} aria-label="ロック" /> : <small>{account.state === "online" ? modelsOf(account).length : "!"}</small>}
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
                      <SquarePen size={13} /> 「{sourceAccount.label}」で新しいチャット
                    </button>
                  </div>
                )}
                {visible.map((choice, index) => {
                  const { account, model } = choice;
                  const selected = choiceKey(choice) === choiceKey(current);
                  const disabled = locked(account) || account.state === "signed-out";
                  const showGroup = searching && (index === 0 || visible[index - 1]?.account.key !== account.key);
                  return (
                    <div key={choiceKey(choice)}>
                      {showGroup && <div className="picker-group-title">{account.label}</div>}
                      <button
                        type="button"
                        className="model-option"
                        role="option"
                        aria-selected={selected}
                        aria-disabled={disabled || undefined}
                        onClick={() => !disabled && setCurrent(choice)}
                      >
                        {tagged && !searching && <ProviderIcon provider={account.provider} size={12} />}
                        <span className="model-option-name">{model.name}</span>
                        {tagged && !searching && shortLabel(account) && <small className="acp-account-chip">{shortLabel(account)}</small>}
                        <span className="model-capabilities">
                          {model.reasoning && <Brain size={12} aria-label="推論" />}
                          {model.vision && <Image size={12} aria-label="画像" />}
                          <small>{Math.round(model.context / 1000)}k</small>
                        </span>
                        <span className="model-selected-mark">{selected && <Check size={13} />}</span>
                      </button>
                    </div>
                  );
                })}
                {!visible.length && <p className="picker-empty">一致するモデルがありません</p>}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="composer acp-composer">
        <div className="acp-composer-text">メッセージを入力…</div>
        <div className="composer-toolbar">
          <span className="picker-trigger acp-trigger" aria-label={`モデル: ${current.model.name}, ${current.account.label}`}>
            {shortLabel(current.account) && (
              <span className="acp-trigger-account">
                <ProviderIcon provider={current.account.provider} size={11} />
                {shortLabel(current.account)}
              </span>
            )}
            <span className="picker-model-label">{current.model.name}</span>
            <span className="picker-effort-label">Medium</span>
            <ChevronDown size={12} />
          </span>
        </div>
      </div>
    </div>
  );
}
