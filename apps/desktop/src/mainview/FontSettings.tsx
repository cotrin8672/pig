import { useEffect, useState } from "react";
import { FontPicker } from "./FontPicker";
import { getT, useT } from "./i18n";
import { SettingsCard } from "./patterns/SettingsCard";
import { SettingsRow } from "./patterns/SettingsRow";
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
    <SettingsCard className="font-settings">
      {(
        [
          ["fontFamily", t["Interface font"]],
          ["codeFontFamily", t["Code font"]],
        ] as const
      ).map(([field, label]) => (
        <SettingsRow
          key={field}
          setting={field === "fontFamily" ? "interface-font" : "code-font"}
          label={label}
        >
          <FontPicker
            label={label}
            value={settings[field]}
            fonts={fonts}
            onChange={(family) => updateSettings({ [field]: family })}
          />
        </SettingsRow>
      ))}
    </SettingsCard>
  );
}
