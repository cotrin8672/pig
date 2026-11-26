import {
  Import,
  Info,
  Keyboard,
  Palette,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  type ActionId,
  actionIds,
  comboFromEvent,
  defaultBindings,
  normalizeCombo,
  resolveBindings,
} from "../shared/keymap";
import { AppUpdateSettings } from "./AppUpdateSettings";
import { ChatHistoryImport } from "./ChatHistoryImportSettings";
import { ChatRendererSettings } from "./ChatRendererSettings";
import { ColorPicker } from "./ColorPicker";
import { ContentPage } from "./ContentPage";
import { DefaultModelSettings } from "./DefaultModelSettings";
import { FontSettings } from "./FontSettings";
import { useT } from "./i18n";
import { PiDataSettings } from "./PiDataSettings";
import { SettingsCard } from "./patterns/SettingsCard";
import { SettingsRow } from "./patterns/SettingsRow";
import { Checkbox } from "./primitives/Checkbox";
import { IconButton } from "./primitives/IconButton";
import { Keycap } from "./primitives/Keycap";
import { SearchField } from "./primitives/SearchField";
import { SegmentedControl } from "./primitives/SegmentedControl";
import { Select } from "./primitives/Select";
import { updateAppearance, updateSettings } from "./rpc";
import { SessionTitleSettings } from "./SessionTitleSettings";
import { revealTarget } from "./search-target";
import { actionLabels, settingsCategories } from "./settings-search";
import { type SettingsCategory, useStore } from "./store";
import "./settings.css";

export function Settings() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const category = useStore((s) => s.settingsCategory);
  const focus = useStore((s) => s.settingsFocus);
  const setCategory = (settingsCategory: SettingsCategory) =>
    useStore.setState({ settingsCategory });
  useEffect(() => {
    if (!focus) return;
    return revealTarget(
      () => document.querySelector(`[data-setting="${CSS.escape(focus)}"]`),
      () => useStore.setState({ settingsFocus: undefined }),
    );
  }, [focus]);
  const icons = {
    general: Settings2,
    appearance: Palette,
    keyboard: Keyboard,
    import: Import,
    updates: Info,
  };
  const categories = settingsCategories.map(({ id, label }) => ({
    id,
    label: t[label],
    icon: icons[id],
  }));
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
            <>
              <DefaultModelSettings />
              <SessionTitleSettings />
            </>
          )}
          {category === "general" && (
            <SettingsCard>
              <SettingsRow
                setting="language"
                label={<label htmlFor="settings-language">{t.Language}</label>}
              >
                <Select
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
                </Select>
              </SettingsRow>
              <SettingsRow
                setting="agent-shell"
                label={
                  <label htmlFor="settings-agent-shell">
                    {t["Agent shell"]}
                  </label>
                }
              >
                <Select
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
                </Select>
              </SettingsRow>
              <SettingsRow
                setting="block-images"
                label={
                  <label htmlFor="settings-block-images">
                    {t["Block images"]}
                  </label>
                }
              >
                <Checkbox
                  id="settings-block-images"
                  checked={settings.blockImages}
                  onChange={(event) =>
                    updateSettings({ blockImages: event.target.checked })
                  }
                />
              </SettingsRow>
              <SettingsRow
                setting="context-display"
                label={
                  <span id="context-display-label">{t["Context display"]}</span>
                }
              >
                <SegmentedControl
                  aria-labelledby="context-display-label"
                  value={settings.contextDisplay}
                  onChange={(mode) => updateSettings({ contextDisplay: mode })}
                  options={[
                    { value: "remaining", label: t.Remaining },
                    { value: "used", label: t.Used },
                  ]}
                />
              </SettingsRow>
              <SettingsRow
                setting="usage-display"
                label={<span id="usage-display-label">{t.usageDisplay}</span>}
              >
                <SegmentedControl
                  aria-labelledby="usage-display-label"
                  value={settings.usageDisplay}
                  onChange={(mode) => updateSettings({ usageDisplay: mode })}
                  options={[
                    { value: "remaining", label: t.Remaining },
                    { value: "used", label: t.Used },
                  ]}
                />
              </SettingsRow>
            </SettingsCard>
          )}
          {category === "appearance" && (
            <>
              <AppearanceSettings />
              <FontSettings />
              <ChatRendererSettings />
            </>
          )}
          {category === "keyboard" && <KeyboardSettings />}
          {category === "import" && <ChatHistoryImport />}
          {category === "updates" && (
            <>
              <AppUpdateSettings />
              <PiDataSettings />
            </>
          )}
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
  const labels = Object.fromEntries(
    actionIds.map((action) => [action, t[actionLabels[action]]]),
  ) as Record<ActionId, string>;
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
      <SearchField
        className="settings-search"
        type="search"
        aria-label={t["Search shortcuts"]}
        placeholder={t["Search shortcuts"]}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <SettingsCard>
        {filtered.map((action) => (
          <SettingsRow
            key={action}
            setting={`shortcut-${action}`}
            label={labels[action]}
          >
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
                      <Keycap key={key}>{key}</Keycap>,
                    ])
                  ) : (
                    <span className="settings-unbound">{t.Unbound}</span>
                  )}
                </button>
                <IconButton
                  aria-label={`${labels[action]}: ${t.Reset}`}
                  disabled={!Object.hasOwn(settings.keybindings, action)}
                  onClick={() => bind(action, undefined)}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                </IconButton>
                <IconButton
                  aria-label={`${labels[action]}: ${t.Clear}`}
                  disabled={!bindings[action]}
                  onClick={() => bind(action, null)}
                >
                  <X size={14} aria-hidden="true" />
                </IconButton>
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
      </SettingsCard>
    </>
  );
}

export function AppearanceSettings() {
  const t = useT();
  const appearance = useStore((s) => s.appearance);
  const alpha = Math.round(appearance.opacity[appearance.backdrop] * 100);
  return (
    <>
      <SettingsCard>
        <SettingsRow setting="theme-color" label={t.themeColor}>
          <ColorPicker
            label={t.themeColor}
            value={appearance.themeColor}
            onChange={(themeColor) =>
              updateAppearance((current) => ({ ...current, themeColor }))
            }
          />
        </SettingsRow>
        <SettingsRow
          setting="backdrop"
          label={<span id="backdrop-label">{t["Window backdrop"]}</span>}
        >
          <SegmentedControl
            aria-labelledby="backdrop-label"
            value={appearance.backdrop}
            onChange={(backdrop) =>
              updateAppearance((current) => ({
                ...current,
                backdrop,
                effect: backdrop === "none" ? current.effect : backdrop,
              }))
            }
            options={[
              { value: "none", label: t.None },
              { value: "acrylic", label: t.Acrylic },
              { value: "mica", label: t.Mica },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          setting="window-opacity"
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
      </SettingsCard>
      <p className="settings-hint">
        {t["Acrylic and Mica require Windows 11."]}
      </p>
    </>
  );
}
