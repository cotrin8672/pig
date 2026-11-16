---
name: visualize
description: Show a diagram, chart, comparison, timeline, or UI sketch inline in the conversation with the show_widget tool. Use when seeing the structure, data, or layout makes an explanation clearly easier to follow. Only applies when a show_widget tool is available.
---

# Visualize

Draw a self-contained HTML or SVG fragment that the app renders inside the
conversation. Read this file in full before the first `show_widget` call of a
session.

## When to use it

- Use it when a picture explains better than text: architecture and data flow,
  state machines, timelines, distributions and trends, before/after
  comparisons, layout sketches of a proposed UI.
- Do not use it for a table (write a Markdown table), for a structure that a
  plain node-and-edge diagram fully describes (write a fenced `mermaid` block),
  or when the user asked for a file, page, or component in their project
  (write the file instead).
- One visual per point. Do not decorate answers that are already clear.

## The call

```
show_widget({
  title: "Request lifecycle",        // short, shown above the visual
  widget_code: "<svg …>…</svg>",     // the fragment
  mode: "wide"                        // optional; only for wide timelines or side-by-side panels
})
```

- `widget_code` is a fragment: no `<!doctype>`, `<html>`, `<head>` or `<body>`.
  If it starts with `<svg` it is treated as SVG, otherwise as HTML.
- Keep it small: aim for under 30 KB. It stays in the conversation context.
- Write the explanation in your normal reply, not inside the fragment. The
  fragment holds only the visual, its labels, and a legend if needed.

## How it is rendered

- The fragment runs in an isolated frame with **no network access** and,
  in the current app, **no script execution**. Everything must be visible
  and understandable from the markup and CSS alone.
  - Prefer inline SVG and HTML with CSS.
  - CSS `:hover`, transitions, keyframe animations and `<details>` work.
  - A `<script>` may be added only to enhance something that already reads
    correctly without it. Never draw the visual itself from script, and do not
    use `<canvas>`.
- No external resources: no remote images, fonts, stylesheets, or iframes.
  Images must be inline SVG or `data:` URLs. Do not use links or forms.
- Width is about 736px (1,024px with `mode: "wide"`) and can shrink to 320px.
  Use fluid layouts (`max-width: 100%`, flex/grid with wrapping). Never use a
  fixed outer width, `position: fixed`, or viewport-height units.
- The frame grows to the content height. Keep the visual compact and avoid
  empty space at the bottom.
- The background is transparent over the app's dark theme.

## Colors and type

Use these variables; never hardcode light backgrounds or black text.

| Variable | Use |
| --- | --- |
| `--foreground` | Primary text and strokes |
| `--muted-foreground` | Secondary labels, axes, captions |
| `--border` | Grid lines, dividers, outlines |
| `--accent` | The one highlighted series or selection |
| `--success` / `--warning` / `--destructive` | Only for those meanings |
| `--font-sans` / `--font-mono` | Text and code |

- In SVG, use `currentColor` or `var(--…)` for fills and strokes.
- For categories, use the accent plus low-opacity fills
  (`color-mix(in srgb, var(--accent) 20%, transparent)`) rather than many hues.
  Pair color with a label or shape so meaning never depends on color alone.
- Body text inherits 14px. Do not go below 11px. Use weights 400 and 500.

## SVG checklist

- Set `viewBox` and `width="100%"`; let the height follow from the viewBox.
- Use `<line>` for axes and ticks; give stroke-only paths `fill="none"`.
- Leave room for the longest label; labels must not overlap marks or edges.
- Add `role="img"` and a `<title>` (and `<desc>` for anything non-obvious).

## Example

```html
<svg viewBox="0 0 640 120" width="100%" role="img" style="font: 13px var(--font-sans); color: var(--foreground)">
  <title>Request flow: client, API, database</title>
  <g fill="color-mix(in srgb, var(--accent) 18%, transparent)" stroke="var(--border)">
    <rect x="10" y="35" width="150" height="50" rx="8"/>
    <rect x="245" y="35" width="150" height="50" rx="8"/>
    <rect x="480" y="35" width="150" height="50" rx="8"/>
  </g>
  <g fill="currentColor" text-anchor="middle">
    <text x="85" y="65">Client</text>
    <text x="320" y="65">API</text>
    <text x="555" y="65">Database</text>
  </g>
  <g stroke="var(--muted-foreground)" stroke-width="1.5">
    <line x1="160" y1="60" x2="240" y2="60"/>
    <line x1="395" y1="60" x2="475" y2="60"/>
  </g>
</svg>
```
