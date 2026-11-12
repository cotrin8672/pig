import {
  ChevronDown,
  Info,
  Keyboard,
  Palette,
  RotateCcw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  type ActionId,
  actionIds,
  comboFromEvent,
  defaultBindings,
  normalizeCombo,
  resolveBindings,
} from "../shared/keymap";
import { AppUpdateSettings } from "./AppUpdateSettings";
import { ChatRendererSettings } from "./ChatRendererSettings";
import { ContentPage } from "./ContentPage";
import { useT } from "./i18n";
import { updateAppearance, updateSettings } from "./rpc";
import { useStore } from "./store";
import "./settings.css";

function SettingsSection({ children }: { children: ReactNode }) {
  return <div className="settings-card">{children}</div>;
}

function SettingsRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-label">{label}</div>
      {children}
    </div>
  );
}

export function Settings() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const [category, setCategory] = useState("general");
  const categories = [
    { id: "general", label: t.General, icon: Settings2 },
    { id: "appearance", label: t.Appearance, icon: Palette },
    { id: "keyboard", label: t["Keyboard shortcuts"], icon: Keyboard },
    { id: "updates", label: t.appUpdateTitle, icon: Info },
  ];
  return (
    <ContentPage className="settings-page" title={t.Settings}>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t.Settings}>
          {categories.map(({ id, label, icon: Icon }, index) => (
            <button
              key={id}
              id={`settings-category-${id}`}
              type="button"
              aria-current={category === id ? "page" : undefined}
              aria-controls="settings-content"
              tabIndex={category === id ? 0 : -1}
              onClick={() => setCategory(id)}
              onKeyDown={(event) => {
                let next = index;
                if (["ArrowDown", "ArrowRight"].includes(event.key))
                  next = (index + 1) % categories.length;
                else if (["ArrowUp", "ArrowLeft"].includes(event.key))
                  next = (index + categories.length - 1) % categories.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = categories.length - 1;
                else return;
                event.preventDefault();
                event.stopPropagation();
                setCategory(categories[next].id);
                document
                  .getElementById(`settings-category-${categories[next].id}`)
                  ?.focus();
              }}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <section
          id="settings-content"
          className="settings-content"
          aria-labelledby={`settings-category-${category}`}
        >
          <h2>{categories.find(({ id }) => id === category)?.label}</h2>
          {category === "general" && (
            <SettingsSection>
              <SettingsRow
                label={<label htmlFor="settings-language">{t.Language}</label>}
              >
                <div className="settings-select">
                  <select
                    id="settings-language"
                    value={settings.language}
                    onChange={(e) =>
                      updateSettings({
                        language: e.target.value as "en" | "ja",
                      })
                    }
                  >
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </div>
              </SettingsRow>
              <SettingsRow
                label={
                  <label htmlFor="settings-agent-shell">
                    {t["Agent shell"]}
                  </label>
                }
              >
                <div className="settings-select">
                  <select
                    id="settings-agent-shell"
                    value={settings.shell}
                    onChange={(event) =>
                      updateSettings({
                        shell: event.target.value as "git-bash" | "powershell",
                      })
                    }
                  >
                    <option value="git-bash">{t["Git Bash"]}</option>
                    <option value="powershell">{t.PowerShell}</option>
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </div>
              </SettingsRow>
              <SettingsRow
                label={
                  <label htmlFor="settings-block-images">
                    {t["Block images"]}
                  </label>
                }
              >
                <input
                  id="settings-block-images"
                  type="checkbox"
                  checked={settings.blockImages}
                  onChange={(event) =>
                    updateSettings({ blockImages: event.target.checked })
                  }
                />
              </SettingsRow>
              <SettingsRow
                label={
                  <span id="context-display-label">{t["Context display"]}</span>
                }
              >
                <fieldset
                  className="segmented-control"
                  aria-labelledby="context-display-label"
                >
                  {(["remaining", "used"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={settings.contextDisplay === mode}
                      onClick={() => updateSettings({ contextDisplay: mode })}
                    >
                      {mode === "remaining" ? t.Remaining : t.Used}
                    </button>
                  ))}
                </fieldset>
              </SettingsRow>
            </SettingsSection>
          )}
          {category === "appearance" && (
            <>
              <AppearanceSettings />
              <ChatRendererSettings />
            </>
          )}
          {category === "keyboard" && <KeyboardSettings />}
          {category === "updates" && <AppUpdateSettings />}
        </section>
      </div>
    </ContentPage>
  );
}

function KeyboardSettings() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const [capture, setCapture] = useState<ActionId>();
  const [query, setQuery] = useState("");
  const [conflict, setConflict] = useState<{
    action: ActionId;
    other: ActionId;
  }>();
  const bindings = resolveBindings(settings.keybindings);
  const labels = {
    "appearance.toggleBackdrop": t["Toggle backdrop"],
    "navigation.back": t.Back,
    "navigation.forward": t.Forward,
    "settings.open": t["Open settings"],
    "composer.queue": t["Queue follow-up"],
    "composer.steer": t["Steer response"],
    "composer.newline": t["Insert newline"],
  };
  function bind(action: ActionId, combo: string | null | undefined) {
    const keybindings = { ...useStore.getState().settings.keybindings };
    const current = resolveBindings(keybindings);
    const candidate = combo === undefined ? defaultBindings[action] : combo;
    const other =
      candidate &&
      actionIds.find(
        (id) =>
          id !== action &&
          current[id] !== null &&
          normalizeCombo(current[id]) === normalizeCombo(candidate),
      );
    if (other) {
      setConflict({ action, other });
      return;
    }
    if (combo === undefined) delete keybindings[action];
    else keybindings[action] = combo;
    updateSettings({ keybindings });
    setConflict(undefined);
    setCapture(undefined);
  }
  const filtered = actionIds.filter((action) =>
    `${labels[action]} ${bindings[action] ?? t.Unbound}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <div className="settings-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          aria-label={t["Search shortcuts"]}
          placeholder={t["Search shortcuts"]}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <SettingsSection>
        {filtered.map((action) => (
          <SettingsRow key={action} label={labels[action]}>
            <div className="settings-binding">
              <div className="settings-binding-controls">
                <button
                  type="button"
                  className="settings-recorder"
                  data-recording={capture === action}
                  aria-label={`${labels[action]}: ${capture === action ? t["Press keys…"] : (bindings[action] ?? t.Unbound)}`}
                  aria-describedby={
                    conflict?.action === action
                      ? `conflict-${action}`
                      : undefined
                  }
                  onClick={() => {
                    setCapture(action);
                    setConflict(undefined);
                  }}
                  onBlur={() => setCapture(undefined)}
                  onKeyDown={(event) => {
                    if (capture !== action) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      setCapture(undefined);
                      setConflict(undefined);
                      return;
                    }
                    if (
                      event.repeat ||
                      event.nativeEvent.isComposing ||
                      event.keyCode === 229
                    )
                      return;
                    const combo = comboFromEvent(event);
                    if (combo) bind(action, combo);
                  }}
                >
                  {capture === action ? (
                    t["Press keys…"]
                  ) : bindings[action] ? (
                    bindings[action].split("+").flatMap((key, index) => [
                      index ? (
                        <span
                          key={`${key}-separator`}
                          className="settings-key-separator"
                          aria-hidden="true"
                        >
                          +
                        </span>
                      ) : null,
                      <kbd key={key}>
                        {(
                          {
                            ArrowLeft: "←",
                            ArrowRight: "→",
                            ArrowUp: "↑",
                            ArrowDown: "↓",
                          } as Record<string, string>
                        )[key] ?? key}
                      </kbd>,
                    ])
                  ) : (
                    <span className="settings-unbound">{t.Unbound}</span>
                  )}
                </button>
                <button
                  type="button"
                  className="settings-icon-button"
                  aria-label={`${labels[action]}: ${t.Reset}`}
                  title={`${labels[action]}: ${t.Reset}`}
                  disabled={!Object.hasOwn(settings.keybindings, action)}
                  onClick={() => bind(action, undefined)}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="settings-icon-button"
                  aria-label={`${labels[action]}: ${t.Clear}`}
                  title={`${labels[action]}: ${t.Clear}`}
                  disabled={!bindings[action]}
                  onClick={() => bind(action, null)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              {conflict?.action === action && (
                <small
                  id={`conflict-${action}`}
                  className="settings-conflict"
                  role="status"
                >
                  {t.shortcutConflict(labels[conflict.other])}
                </small>
              )}
            </div>
          </SettingsRow>
        ))}
        {filtered.length === 0 && (
          <p className="settings-empty">{t["No matching shortcuts"]}</p>
        )}
      </SettingsSection>
    </>
  );
}

function AppearanceSettings() {
  const t = useT();
  const appearance = useStore((s) => s.appearance);
  const alpha = Math.round(appearance.opacity[appearance.backdrop] * 100);
  return (
    <>
      <SettingsSection>
        <SettingsRow
          label={<span id="backdrop-label">{t["Window backdrop"]}</span>}
        >
          <fieldset
            className="segmented-control"
            aria-labelledby="backdrop-label"
          >
            {(["none", "acrylic", "mica"] as const).map((backdrop) => (
              <button
                key={backdrop}
                type="button"
                aria-pressed={appearance.backdrop === backdrop}
                onClick={() =>
                  updateAppearance((current) => ({
                    ...current,
                    backdrop,
                    effect: backdrop === "none" ? current.effect : backdrop,
                  }))
                }
              >
                {backdrop === "none"
                  ? t.None
                  : backdrop === "acrylic"
                    ? t.Acrylic
                    : t.Mica}
              </button>
            ))}
          </fieldset>
        </SettingsRow>
        <SettingsRow
          label={<label htmlFor="window-opacity">{t["Window opacity"]}</label>}
        >
          <div className="settings-opacity">
            <input
              id="window-opacity"
              type="range"
              min="0"
              max="100"
              step="1"
              value={alpha}
              onChange={(event) => {
                const alpha = Number(event.target.value) / 100;
                updateAppearance((current) => ({
                  ...current,
                  opacity: { ...current.opacity, [current.backdrop]: alpha },
                }));
              }}
            />
            <output htmlFor="window-opacity">{alpha}%</output>
          </div>
        </SettingsRow>
      </SettingsSection>
      <p className="settings-hint">
        {t["Acrylic and Mica require Windows 11."]}
      </p>
    </>
  );
}
