# Notecyclopedia — design v1

Live canvas: https://claude.ai/artifact/KtFr1cGxQQpPzK7seYe14H
The `.dc.html` files are the canvas sources (they need the canvas runtime to render). Use them as markup and style reference.

## Screens
| File | Screen | Key parts |
|---|---|---|
| Main.dc.html | Home | Continue reading, pinned formulas, recent source files, AI quick-ask (Ask / Summarize / Solve / Build calculator), my calculators, upload drop zone |
| Wiki.dc.html | Lecture page | Read / Source PDF / History tabs, numbered formula blocks → "Calculate", figure, "My note" callout, worked example; right rail: table of contents, AI actions, source files, backlinks |
| Editor.dc.html | Editor & uploads | Block editor, formula block (LaTeX + preview + variables, "add to index", "generate calculator"), upload list with indexing status, page settings (course, type, tags, AI-visible) |
| Calculators.dc.html | Calculator library | Filters, calculator list, live calculator with inputs/results/plot, export .json / .py / .html widget |
| AIPortal.dc.html | AI portal | Mode tabs, step-by-step solution with formula citations, generated calculator card (Save / Export), sources in context, next steps |

## Design tokens
```css
--bg: #F3F4F0;  --surface: #FFFFFF;  --surface-2: #FAFAF8;
--ink: #16181D; --muted: #565B66;    --line: #DDDFD8; --line-strong: #C9CCC4;
--accent: #1F3FBF; --accent-hover: #15298A; --accent-soft: #E8ECFA;
--ai: #9A4A00;  --ai-text: #8A4300;  --ai-soft: #F7EBDD; --ai-on-dark: #F2B66D;
--note-bg: #FFF8E8; --note-line: #EAD9A8; --ok: #2F7D4F;
--radius: 10px; --radius-lg: 14px;
--font-ui: "Schibsted Grotesk"; --font-read: "Source Serif 4"; --font-mono: "IBM Plex Mono";
```
Graph-paper texture on formula/calculator surfaces: 1px #EEF0EA lines at 16px.

## Calculator spec (export format)
```json
{ "name": "Projectile motion",
  "inputs":  { "v0": "m/s", "theta": "deg", "g": "m/s²" },
  "outputs": { "R": "v0^2 * sin(2*theta) / g",
               "H": "v0^2 * sin(theta)^2 / (2*g)",
               "T": "2 * v0 * sin(theta) / g" } }
```
