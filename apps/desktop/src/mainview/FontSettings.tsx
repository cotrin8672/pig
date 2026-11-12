import { useEffect, useState } from "react";
import { FontPicker } from "./FontPicker";
import { getT, useT } from "./i18n";
import { rpc, updateSettings } from "./rpc";
import { showError, useStore } from "./store";

export function FontSettings() {
  const t = useT();
  const settings = useStore((state) => state.settings);
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    // Each visit reads again, including fonts installed while pig was running.
    void rpc.request.listFontFamilies().then(
      (families) => {
        if (cancelled) return;
        setFonts(families);
      },
      (error) => {
        console.error("Cannot list installed fonts:", error);
        if (!cancelled) showError(getT()["Could not load installed fonts."]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="settings-card font-settings">
      {(
        [
          ["fontFamily", t["Interface font"]],
          ["codeFontFamily", t["Code font"]],
        ] as const
      ).map(([field, label]) => (
        <div className="settings-row" key={field}>
          <div className="settings-label">{label}</div>
          <FontPicker
            label={label}
            value={settings[field]}
            fonts={fonts}
            onChange={(family) => updateSettings({ [field]: family })}
          />
        </div>
      ))}
    </div>
  );
}
