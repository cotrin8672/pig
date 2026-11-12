import {
  ChevronRight,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import {
  type AccountSource,
  providerAccountSources,
} from "../shared/account-models";
import type { AccountTarget } from "../shared/provider-accounts";
import type { ProviderInfo } from "../shared/rpc-schema";
import { ActionsMenu } from "./ActionsMenu";
import { ConfirmButton } from "./ConfirmButton";
import { InlineRename } from "./InlineRename";
import { useT } from "./i18n";
import { ProviderIcon } from "./ProviderIcon";
import { startProviderLogin } from "./provider-login";
import { refresh, rpc } from "./rpc";
import { showError, useStore } from "./store";
import "./provider-accounts.css";

export function ProviderAccounts({
  provider: p,
  selected,
  query,
  onSelect,
}: {
  provider: ProviderInfo;
  selected?: AccountTarget;
  query: string;
  onSelect: (target: AccountTarget) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState<string>();
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const accounts = providerAccountSources(p);
  const nested = accounts.length > 1;
  const canAdd =
    p.oauth?.subscription && accounts.some((account) => account.configured);
  const mine = selected?.provider === p.id;
  const visible = expanded || !!query;
  function target(account: AccountSource): AccountTarget {
    return { provider: p.id, accountId: account.accountId };
  }
  function rename(account: AccountSource, label: string) {
    const change = account.accountId
      ? rpc.request.renameProviderAccount({
          provider: p.id,
          accountId: account.accountId,
          label,
        })
      : rpc.request.renameDefaultProviderAccount({ provider: p.id, label });
    void change.then(refresh).catch(showError);
  }
  async function signOut(account: AccountSource, remove = false) {
    setBusy(true);
    try {
      const login = useStore.getState().login;
      if (
        login?.provider === p.id &&
        login.accountId === account.accountId &&
        !login.addAccount
      ) {
        rpc.send.cancelLogin({ loginId: login.loginId });
        useStore.setState({ login: undefined });
      }
      if (remove && account.accountId) {
        await rpc.request.removeProviderAccount({
          provider: p.id,
          accountId: account.accountId,
        });
        if (selected?.accountId === account.accountId)
          onSelect({ provider: p.id });
      } else await rpc.request.logout(target(account));
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }
  function actions(account: AccountSource) {
    if (!p.oauth?.subscription) return null;
    return (
      <ActionsMenu label={t.accountActions(account.label)} disabled={busy}>
        {(close) => (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                setRenaming(account.key);
              }}
            >
              <Pencil size={13} /> {t["Edit name"]}
            </button>
            {account.configured && (account.accountId || p.stored) ? (
              <ConfirmButton
                role="menuitem"
                onConfirm={() => {
                  close();
                  void signOut(account);
                }}
              >
                <LogOut size={13} /> {t["Sign out"]}
              </ConfirmButton>
            ) : !account.configured ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  startProviderLogin(target(account));
                }}
              >
                <LogIn size={13} /> {t["Sign in"]}
              </button>
            ) : null}
            {account.accountId && (
              <ConfirmButton
                role="menuitem"
                className="session-menu-delete"
                onConfirm={() => {
                  close();
                  void signOut(account, true);
                }}
              >
                <Trash2 size={13} /> {t.removeAccount}
              </ConfirmButton>
            )}
          </>
        )}
      </ActionsMenu>
    );
  }
  function status(account: AccountSource) {
    return (
      <span
        className="provider-account-dot"
        data-connected={account.configured || undefined}
        role="img"
        aria-label={account.configured ? t.Connected : t["Not connected"]}
      />
    );
  }
  function row(account: AccountSource, child = false) {
    const active = mine && selected?.accountId === account.accountId;
    return (
      <div
        key={account.key}
        className="provider-account-row"
        data-nested={child || undefined}
        data-current={active || undefined}
      >
        {renaming === account.key ? (
          <div className="provider-row provider-account-renaming">
            {status(account)}
            {!child && <ProviderIcon provider={p.id} size={16} />}
            <InlineRename
              value={account.label}
              label={t.accountName}
              onCommit={(name) => rename(account, name)}
              onDone={() => setRenaming(undefined)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="provider-row"
            aria-current={active || undefined}
            onClick={() => onSelect(target(account))}
          >
            {status(account)}
            {!child && <ProviderIcon provider={p.id} size={16} />}
            <span className="provider-row-name">{account.label}</span>
            {child && !account.accountId && (
              <small className="provider-tag">{t.standardAccount}</small>
            )}
            {!child && p.extension && (
              <small className="provider-tag" data-kind="extension">
                {t.Extension}
              </small>
            )}
          </button>
        )}
        <div className="provider-account-actions">
          {!child && canAdd && addButton()}
          {renaming !== account.key && actions(account)}
        </div>
      </div>
    );
  }
  function addButton() {
    return (
      <button
        type="button"
        className="provider-account-add"
        title={t.addAccount}
        aria-label={t.addAccountTo(p.name)}
        onClick={() => {
          setExpanded(true);
          startProviderLogin({ provider: p.id, addAccount: true });
        }}
      >
        <Plus size={13} />
      </button>
    );
  }
  if (!nested) return row(accounts[0]);
  return (
    <section className="provider-account-group" aria-label={p.name}>
      <div className="provider-account-row">
        <button
          type="button"
          className="provider-row"
          aria-expanded={visible}
          aria-controls={listId}
          onClick={() => setExpanded(!visible)}
        >
          <ChevronRight
            className="provider-account-chevron"
            size={12}
            aria-hidden="true"
          />
          <ProviderIcon provider={p.id} size={16} />
          <span className="provider-row-name">{p.name}</span>
        </button>
        {canAdd && (
          <div className="provider-account-actions">{addButton()}</div>
        )}
      </div>
      <div id={listId} hidden={!visible}>
        {accounts.map((account) => row(account, true))}
      </div>
    </section>
  );
}
