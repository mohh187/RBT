# Design

Captures the real visual system in `src/index.css` (single stylesheet, CSS-variable tokens, RTL-first). The venue brand color is tenant-set at runtime (`--brand-base`); everything derives from it per light/dark mode.

**This file is read by the design skills on startup.** When a token below disagrees with `src/index.css`, the stylesheet is right and this file is stale — fix it here rather than working from the wrong value.

## Two visual registers, deliberately different

| Register | Where | Reads as |
|---|---|---|
| **Diner** | the public menu (`/m/:slug`), its 16 layouts and skins | expressive, brand-led, per-venue |
| **Console** | venue admin, cashier, KDS, platform console | a system of record — dense, square, quiet |

They share `index.css` but not its proportions. The console overrides geometry through a scoped layer (below). A change aimed at one register must never leak into the other, and the selectors are chosen so it cannot.

## Theme

Light and dark, per-mode via `[data-theme]`. Neutral base (true near-white / near-black), tenant brand as the single accent. The **platform console** runs an isolated fixed identity (violet + cyan on slate, `.platform-scope`) that never inherits a venue theme.

## Color

- **Neutrals (light):** `--bg #fafafa`, `--surface #ffffff`, `--surface-2 #f5f5f6`, `--text #0a0a0b`, `--text-muted #5c5c66`, `--text-faint #6e6e78`, `--border #e7e7ea`, `--border-strong #d6d6db`.
- **Neutrals (dark):** `--bg #0a0a0b`, `--surface #161618`, `--surface-2 #202023`, `--text #fafafa`, `--text-muted #a1a1aa`, `--border #29292e`.
- **Brand (single accent):** `--brand` from `--brand-base` (tenant-set; default **slate `#1F2A37`**), with `--brand-strong`, `--brand-soft`, `--on-brand`. Companion `--accent` (default **brass `#8A6A3F`**), `--gold #c8a15a`.
- **Semantic (state carries meaning):** `--success #2e7d52`, `--warning #b26a12`, `--danger #C0262C`, `--info #3a6ea5` (+ `-soft` tints + `.badge-*`). Used for order states, stock, alerts.
- Shadows are warm-tinted (`rgba(33,25,19,·)` in light), not pure black. `--sh-1/2/3`.

**Colour is for state, not decoration.** In a console row a hue must answer "what is wrong / what changed". A row carrying more than two simultaneous hues is a defect — see the anti-patterns below.

## Typography

- One family, many weights: **IBM Plex Sans Arabic** (Tajawal is the fallback) — `--font-body` = `--font-display`. Arabic-first; latin fallback system stack. `--font-brand` is Montserrat, wordmark only.
- Scale: `--fs-xs .75 → --fs-sm .8125 → --fs-base .9375 → --fs-md 1.0625 → --fs-lg 1.375 → --fs-xl 1.75 → --fs-2xl 2.25 → --fs-display clamp(2,7vw,3.25rem)`. Line-height `--lh 1.6`, tight `1.2`.
- **Data uses tabular figures** (`.num`, `.price`: `font-variant-numeric: tabular-nums`).
- The console re-scales this down; a 22px page title belongs to the diner register, not to a record header.

## Components

Utility-class system: `.card`/`.card-pad`, `.stat`/`.stat-grid`, `.badge`(+`-success/warning/danger/info/gold`), `.btn`(+`-primary/outline/danger/success/sm/xs/lg/block/icon`) with `:active` scale + hover (guarded), `.input`/`.select`/`.textarea`(+`-sm`), `.chip`, `.list-row`, `.divide`, `.empty`, `.spinner`/`.skeleton`, `.sheet`, `.stepper`, `.segmented`. Shells: `.admin-shell` (sidebar + bottom-nav), `.cashier-shell`, `.kds-shell`. Diner menu has a separate **skins** system (`skins.js`).

**`.list-row` is the console's record primitive, not `.card`.** A list of records is rows separated by lines; a card per record is a phone-app idiom that costs several times the vertical space and stops the eye scanning a column. `src/routes/admin/Costing.jsx` and `Variance.jsx` are the reference implementations.

## Layout

- Radii: `--r-sm 8 / --r-md 14 / --r-lg 20 / --r-xl 28 / --r-pill 999` — **diner values**. The console layer squares these; see below.
- Spacing scale `--sp-1..--sp-12` (4px grid). Tap target `--tap 44px`. Container `--maxw 1080`. App bar 56, bottom nav 64. Safe-area insets respected.
- Semantic z-index scale (`--z-appbar … --z-toast`). RTL logical properties throughout — `inset-inline-*`, `border-inline-*`, `padding-inline-*`, never `left`/`right`.

## The console density layer

Two files, same technique, ~30 token declarations each and **zero JSX**:

- `src/styles/platform-console.css` — scoped `.platform-scope.admin-shell` (the platform console).
- `src/styles/venue-console.css` — scoped `.admin-shell:not(.platform-scope)`, `.cashier-shell`, `.kds-shell` (every venue back-office screen).

Both re-declare geometry only: type down one step, spacing halved, **radius 2–6px**, `--sh-1: none` (an ERP separates with lines, not shadows), `--tap: 36px`. Neither touches colour, so a venue's brand still carries through.

`--r-pill` is the single loudest lever on a page. Pills on badges and chips are the strongest "consumer app" signal a console can carry; squaring them changes the read more than any colour choice.

## Motion

- Durations `--dur-fast 120ms / --dur 200 / --dur-slow 320`; ease `cubic-bezier(0.22,0.61,0.36,1)` (ease-out), `--ease-out-strong` for POS/KDS feedback. No bounce, no elastic, no spring.
- **Motion confirms an action; it does not announce a screen.** A page-level enter animation is a website idiom — a console swaps panes instantly. Transitions belong on interactive state (hover, press, open/close), never on navigation.
- Never `transition: all` — name the properties, or layout animates by accident.
- Full `prefers-reduced-motion` fallback (global kill-switch in `index.css` + ~50 targeted blocks + JS guards). This is comprehensive and correct: **do not weaken it.**

## Anti-patterns — what "AI-generated" means in this repo

Found by audit, in order of how loudly each reads:

1. **20px radius plus a shadow on every card.** Consumer geometry on a data surface.
2. **A coloured circle holding an icon** beside a number (`width:40;height:40;border-radius:50%;background:var(--x-soft)`), and 4px coloured accent rails on rows.
3. **Colour count per row.** Eight simultaneous hues in one record — state rail, category badge, status badge, gauge fill, and four differently-tinted action buttons.
4. **A card per record** instead of a row; a card nested inside a card.
5. **Pill-inside-pill** — a 999px chip containing a 999px count badge.
6. **Gradient hero cards** ("top performer", in gold). The repo has 11 gradients in total and 10 are legitimate colour-swatch previews; a gradient on a data card is not one.
7. **A decorative progress gauge** where a number would do.

## Back-office Templates

Sections offer selectable layout templates (`src/lib/systemTemplates.js`) applied via `data-template`, gated by plan (`systemTemplates` = Pro+). Cashier: grid/compact/touch/lite · KDS: rail/kanban/grid/display · Dashboard: exec/ops/min · Menu: table/cards/catalog · Orders: kanban/timeline.

## Hard project rules

- **No emojis anywhere in `src/`** — icons come from `Icon.jsx` / inline SVG. Enforced by `scripts/guard.mjs`.
- **Latin digits only** — `'ar-SA-u-nu-latn'`, never Arabic-Indic numerals. Same guard.
- **No visible scrollbars, ever** — overlay hover-only thumbs; shrink or wrap content rather than scroll it.
