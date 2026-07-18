# Design

Captures the real visual system in `src/index.css` (single stylesheet, CSS-variable tokens, RTL-first). The venue brand color is tenant-set at runtime (`--brand-base`); everything derives from it per light/dark mode.

## Theme

Light and dark, per-mode via `[data-theme]`. Neutral base (true near-white / near-black), tenant brand as the single accent. The **platform console** runs an isolated fixed identity (violet + cyan on slate, `.platform-scope`) that never inherits a venue theme.

## Color

- **Neutrals (light):** `--bg #fafafa`, `--surface #ffffff`, `--surface-2 #f5f5f6`, `--text #0a0a0b`, `--text-muted #5c5c66`, `--text-faint #9a9aa5`, `--border #e7e7ea`, `--border-strong #d6d6db`.
- **Neutrals (dark):** `--bg #0a0a0b`, `--surface #161618`, `--surface-2 #202023`, `--text #fafafa`, `--text-muted #a1a1aa`, `--border #29292e`.
- **Brand (single accent):** `--brand` from `--brand-base` (tenant-set; default maroon `#7c2d2d`), with `--brand-strong`, `--brand-soft`, `--on-brand`. Cool cousin `--accent`, `--gold #c8a15a`.
- **Semantic (state carries meaning):** `--success #2e7d52`, `--warning #b26a12`, `--danger #b23b3b`, `--info #3a6ea5` (+ `-soft` tints + `.badge-*`). Used for order states, stock, alerts.
- Shadows are warm-tinted (`rgba(33,25,19,·)` in light), not pure black. `--sh-1/2/3`.

## Typography

- One family, many weights: **Tajawal** 400/500/700/800/900 (`--font-body` = `--font-display`). Arabic-first; latin fallback system stack.
- Scale: `--fs-xs .75 → --fs-md 1.06 → --fs-lg 1.375 → --fs-xl 1.75 → --fs-2xl 2.25 → --fs-display clamp(2,7vw,3.25rem)`. Line-height `--lh 1.6`, tight `1.2`.
- **Data uses tabular figures** (`.num`, `.price`: `font-variant-numeric: tabular-nums`).

## Components

Utility-class system: `.card`/`.card-pad`, `.stat`/`.stat-grid`, `.badge`(+`-success/warning/danger/info/gold`), `.btn`(+`-primary/outline/danger/success/sm/xs/lg/block/icon`) with `:active` scale + hover (guarded), `.input`/`.select`/`.textarea`(+`-sm`), `.chip`, `.list-row`, `.divide`, `.empty`, `.spinner`/`.skeleton`, `.sheet`, `.stepper`. Shells: `.admin-shell` (sidebar + bottom-nav), `.cashier-shell`, `.kds-shell`. Diner menu has a separate **skins** system (`skins.js`).

## Layout

- Radii: `--r-sm 8 / --r-md 14 / --r-lg 20 / --r-xl 28 / --r-pill 999`.
- Spacing scale `--sp-1..--sp-12`. Tap target `--tap 44px`. Container `--maxw 1080`. App bar 56, bottom nav 64. Safe-area insets respected.
- Semantic z-index scale (`--z-appbar … --z-toast`). RTL logical properties throughout.

## Motion

- Durations `--dur-fast 120ms / --dur 200 / --dur-slow 320`; ease `cubic-bezier(0.22,0.61,0.36,1)` (ease-out). No bounce/elastic. Full `prefers-reduced-motion` fallback (near-instant).

## Back-office Templates (new)

Sections offer selectable layout templates (`src/lib/systemTemplates.js`) applied via `data-template`, gated by plan (`systemTemplates` = Pro+). Cashier: grid/compact/touch/lite · KDS: rail/kanban/grid/display · Dashboard: exec/ops/min · Menu: table/cards/catalog · Orders: kanban/timeline.
