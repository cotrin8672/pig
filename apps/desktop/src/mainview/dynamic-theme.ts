import {
  argbFromHex,
  Blend,
  Hct,
  hexFromArgb,
  SchemeMonochrome,
  SchemeTonalSpot,
  TonalPalette,
} from "@material/material-color-utilities";
import { defaultThemeColor, normalizeThemeColor } from "../shared/theme-color";

/** Stable spec/version; no image extraction, network requests or DOM needed. */
export function createThemeTokens(
  seed: string,
): Record<`--ds-${string}`, string> {
  const source = argbFromHex(normalizeThemeColor(seed) ?? defaultThemeColor);
  const hct = Hct.fromInt(source);
  // Hue is undefined perceptually for achromatic seeds: don't invent a blue tint.
  const scheme =
    hct.chroma < 4
      ? new SchemeMonochrome(hct, true, 0, "2021")
      : new SchemeTonalSpot(hct, true, 0, "2021");
  const hex = hexFromArgb;
  const neutral = (tone: number) => hex(scheme.neutralPalette.tone(tone));
  const primary = (tone: number) => hex(scheme.primaryPalette.tone(tone));
  const secondary = (tone: number) => hex(scheme.secondaryPalette.tone(tone));
  const extended = (color: string, tone = 80) =>
    hex(
      TonalPalette.fromInt(Blend.harmonize(argbFromHex(color), source)).tone(
        tone,
      ),
    );
  // Surfaces sit on Acrylic/transparency, so they carry the main colour itself;
  // TonalSpot's neutral (~chroma 4) reads as grey. Text stays on neutral/ink.
  const surface = (tone: number) =>
    hct.chroma < 4 ? neutral(tone) : primary(tone);
  const ink = hex(scheme.onSurface);
  const success = extended("#249c64");
  const warning = extended("#d99a20");
  const error = hex(scheme.error);
  return {
    "--ds-accent": hex(scheme.primary),
    "--ds-on-accent": hex(scheme.onPrimary),
    "--ds-accent-hover": primary(87),
    "--ds-accent-soft": secondary(80),
    "--ds-bg-active": `${primary(80)}1f`,
    "--ds-bg-chip": `${ink}0d`,
    "--ds-bg-composer": `${surface(25)}e6`,
    "--ds-bg-elevated": `${surface(22)}f5`,
    "--ds-bg-elevated-opaque": surface(22),
    // Light alpha: a dense overlay on the shell hides the backdrop.
    "--ds-bg-popover": `${surface(22)}66`,
    "--ds-bg-hover": `${ink}0d`,
    "--ds-bg-inset": surface(12),
    "--ds-bg-primary": surface(18),
    "--ds-bg-secondary": surface(25),
    "--ds-bg-sidebar": `${surface(6)}1f`,
    "--ds-bg-tertiary": surface(23),
    "--ds-bg-under": surface(18),
    "--ds-shell-start": surface(21),
    "--ds-shell-end": surface(16),
    "--ds-border-default": "transparent",
    "--ds-border-subtle": "transparent",
    "--ds-border-strong": `${hex(scheme.outline)}60`,
    "--ds-elevation-stroke": `0 0 0 0.5px ${ink}1a`,
    "--ds-field-inset-bg": `${ink}0d`,
    "--ds-focus": primary(90),
    "--ds-placeholder-ink": neutral(72),
    "--ds-raised": surface(25),
    "--ds-shadow-composer": `0 6px 18px ${neutral(3)}3d, inset 0 1px 0 ${ink}08`,
    "--ds-shadow-dialog": `0 16px 48px ${neutral(3)}66`,
    "--ds-text-faint": neutral(69),
    "--ds-text-muted": neutral(72),
    "--ds-text-primary": ink,
    "--ds-text-secondary": hex(scheme.onSurfaceVariant),
    "--ds-tool-row-bg": `${ink}07`,
    "--ds-tile": `${ink}08`,
    "--ds-tile-hover": `${ink}0f`,
    "--ds-thinking-code-bg": surface(12),
    "--ds-success": success,
    "--ds-error": error,
    "--ds-on-error": hex(scheme.onError),
    "--ds-warning": warning,
    "--ds-info": primary(80),
    "--ds-purple": extended("#9b71dc"),
    "--ds-scrollbar-thumb": `${ink}2e`,
    "--ds-scrollbar-thumb-hover": `${ink}52`,
    "--ds-syntax-keyword": primary(80),
    "--ds-syntax-function": extended("#489aad"),
    "--ds-syntax-type": extended("#469d91"),
    "--ds-syntax-string": success,
    "--ds-syntax-number": extended("#9b71dc"),
    "--ds-syntax-comment": neutral(65),
    "--ds-syntax-constant": warning,
    "--ds-syntax-decorator": extended("#c18051"),
    "--ds-syntax-text": ink,
  };
}

export function applyThemeTokens(style: CSSStyleDeclaration, seed: string) {
  const tokens = createThemeTokens(seed);
  for (const [name, value] of Object.entries(tokens))
    style.setProperty(name, value);
  return () => {
    for (const name of Object.keys(tokens)) style.removeProperty(name);
  };
}
