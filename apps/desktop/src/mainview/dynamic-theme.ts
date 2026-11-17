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

/** All large surfaces use the faint tint of the plain-transparency background. */
const surfaceChroma = 8;

/** sRGB mix like CSS `color-mix(in srgb, a, b amount)`. */
function mixHex(a: string, b: string, amount: number) {
  const channel = (color: string, i: number) =>
    Number.parseInt(color.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) =>
      Math.round(channel(a, i) * (1 - amount) + channel(b, i) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

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
  // Tertiary is the hue-shifted counterpart: reserved for small "look here"
  // signals (unread, waiting for the user, search hits), never for surfaces.
  const tertiary = (tone: number) => hex(scheme.tertiaryPalette.tone(tone));
  const extended = (color: string, tone = 80) =>
    hex(
      TonalPalette.fromInt(Blend.harmonize(argbFromHex(color), source)).tone(
        tone,
      ),
    );
  // Stacked glass amplifies colour: keep only a hint of the theme in large fills.
  const surfacePalette = TonalPalette.fromHueAndChroma(
    scheme.primaryPalette.hue,
    Math.min(surfaceChroma, scheme.primaryPalette.chroma),
  );
  const surface = (tone: number) =>
    hct.chroma < 4 ? neutral(tone) : hex(surfacePalette.tone(tone));
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
    "--ds-highlight": tertiary(80),
    "--ds-on-highlight": tertiary(20),
    "--ds-bg-highlight": `${tertiary(80)}29`,
    "--ds-bg-chip": `${ink}0d`,
    "--ds-bg-composer": `${surface(25)}e6`,
    "--ds-bg-elevated": `${surface(22)}f5`,
    "--ds-bg-elevated-opaque": surface(22),
    // Floating glass (composer, popovers, panels): a pale wash of the accent
    // over the shell tone, 50% so the backdrop stays visible.
    "--ds-bg-popover": `${mixHex(surface(22), hex(scheme.primary), 0.12)}80`,
    "--ds-bg-hover": `${ink}0d`,
    "--ds-bg-inset": surface(12),
    "--ds-bg-primary": surface(18),
    "--ds-bg-secondary": surface(25),
    "--ds-bg-sidebar": `${surface(6)}1f`,
    // Near-neutral dark veil over the chat: mutes the shell tint for long reading.
    "--ds-bg-chat": `${neutral(8)}38`,
    "--ds-bg-tertiary": surface(23),
    "--ds-bg-under": surface(18),
    "--ds-shell-start": surface(22),
    "--ds-shell-end": surface(18),
    "--ds-shell-clear-start": surface(22),
    "--ds-shell-clear-end": surface(18),
    "--ds-border-default": "transparent",
    "--ds-border-subtle": "transparent",
    "--ds-border-strong": `${hex(scheme.outline)}60`,
    "--ds-elevation-stroke": `0 0 0 0.5px ${ink}1a`,
    "--ds-field-inset-bg": `${ink}0d`,
    // Accent tone (not the near-white 90) so focus rings read as the theme.
    "--ds-focus": hex(scheme.primary),
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
