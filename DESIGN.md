# DESIGN.md

The single source of truth for the visual language of this product.
**Read this file before creating or altering any interface.**

---

## 0. Provenance

The visual language is the Linear-derived product system first built for
**Outlier** (its ADR 015 "Linear-derived design system" and ADR 017 "Theme
system"), which itself reads the published Linear style reference vendored at
`docs/linear-style-reference.md`. The reference is the *source*; Outlier proved
its *structure* in a real product; this file is the *system* for Indica. When
they disagree, this file wins.

What was taken, and what was decided here:

| Area | From the reference / Outlier | Indica decision |
| --- | --- | --- |
| Surfaces | Void → Carbon → Obsidian, hairlines instead of shadows | Same ladder. The app is a sidebar on the canvas plus **one inset, bordered content panel** |
| Accent | One accent for the single primary action | **Monochrome primary**: near-black on light, near-white on dark (2026-09 revision; the earlier signal amber now survives only as the `warning` hue) |
| Light theme | Reference is dark-only; Outlier designed one | Outlier's: a quiet gray canvas around a white panel — designed, not inverted |
| Text | Paper / Mist / Fog / Ash, no chromatic body text | Same four steps; Ash lightened to `#7e838b` so it clears 4.5:1 |
| Type | Inter Variable 400/510/590, `cv01 ss03 zero` | Same. **13px is the product default**; a dense ledger adds `micro`/`label`/`meta` below it and `title` (18px) for record names |
| Keyboard | Command-first: ⌘K, `G` chords, `[` sidebar | Same model, see §11b |
| Status colour | Reference calls green/red decorative | Kept functional: this is a ledger, "reversed" versus "paid" must be legible at a glance — but only as a dot beside a neutral label (§9 Badge) |

---

## 1. Design philosophy

This is a financial instrument disguised as a growth tool. Founders look at it
to answer "how much do I owe, and to whom?". Affiliates look at it to answer
"how much did I earn?". Both questions are about *numbers they trust*.

Five principles, in priority order:

1. **Precision over decoration.** Every pixel either carries information or gets
   out of the way. No ornament that a reader has to visually skip.
2. **Controlled density.** Dense, but never cramped. A data table should feel
   like a terminal that went to design school: many rows visible, generous
   vertical rhythm inside each row.
3. **Hierarchy through contrast, not weight.** We separate with surface shifts,
   hairline borders and text colour — not with bold everything and drop shadows.
4. **The product is the hero.** On marketing pages the screenshot is the art.
   No illustrations, no mascots, no abstract blobs.
5. **Colour means something.** Chromatic colour is a signal, never a mood. See §2.

### Anti-patterns (never ship these)

- Purple/blue gradient hero sections.
- Glassmorphism, heavy backdrop blur, neon glows.
- `shadow-xl` / `shadow-2xl` used to "lift" a card.
- A table, list or empty state wrapped in a card. The panel is already the container.
- `rounded-3xl` on everything.
- Emoji as UI iconography.
- A dashboard that is a 4×3 grid of identical KPI cards.
- Uppercase, letter-spaced column headers. Plain case, muted.
- Stock photography or generic SaaS illustrations.
- Hex colours written inline: `bg-[#08090a]`. (Sole exception: the generated
  OpenGraph image, which Satori renders without CSS variables; it mirrors the
  dark-theme tokens and says so.)
- A keyboard hint for a shortcut that does not work.

---

## 2. Colour

### 2.1 Rules

- Components consume **semantic tokens only** (`bg-surface-1`, `text-muted-foreground`).
- Primitives (`--color-void`, `--color-zinc-200`) exist only inside
  `src/design/tokens.css` to define semantics. Never reference a primitive in a component.
- **The primary is monochrome and rationed.** Ink on light, paper on dark,
  inverted by the tokens — never by `dark:` classes in a component. One primary
  action per view; a header with three solid primary buttons is a bug.
  Saturated colour belongs to status and data, never to "this is important".
  `text-primary-text` (the primary as text) is for the
  rare mark that must read as identity, never for body copy.
- **No chromatic body text.** Colour appears only on the primary action, on
  status dots/deltas, and in charts.
- Status colour is reserved for status. Never use `success` green just because
  a number is "nice".
- Components never branch on the theme (`dark:` variants). Every token is
  defined for both themes; a hard-coded white or black alpha is a light-theme bug.

### 2.2 Semantic tokens

Every one of these is defined for **both** themes in `src/design/tokens.css`.
If you add a token, add it twice.

| Token | Dark | Light | Meaning |
| --- | --- | --- | --- |
| `background` | `#08090a` | `#f4f4f5` | Canvas: the sidebar plane, auth and marketing ground |
| `surface-1` | `#0f1011` | `#ffffff` | The content panel, cards, sticky bars |
| `surface-2` | `#161718` | `#f4f4f5` | Raised: kbd, nested wells |
| `surface-3` | `#1a1b1d` | `#ffffff` | Floating: popovers, menus, dialogs, palette, tooltips |
| `hover` / `selected` | white 4% / 7% | ink 3.5% / 6% | Row, item and nav states |
| `fill-subtle` / `fill` / `fill-strong` | white 2.5 / 5 / 8% | ink 2 / 5 / 8% | Input wells, skeletons, avatar tiles, tracks |
| `border-faint` / `border` / `border-strong` | `#18191c` / `#23252a` / `#383b3f` | `#efeff1` / `#e4e4e7` / `#d1d1d6` | Row separators / hairlines / hover and emphasis |
| `foreground` | `#f7f8f8` | `#111113` | Headings, values, primary text |
| `foreground-secondary` | `#d0d6e0` | `#3a3b40` | Body, table cells |
| `muted-foreground` | `#8a8f98` | `#5b5d65` | Labels, column headers, secondary text |
| `faint-foreground` | `#7e838b` | `#6a6c74` | Metadata, placeholders, section labels |
| `inverse` / `inverse-foreground` | `#e6e7e9` / void | ink / white | Skip link, workspace glyph |
| `primary` / `primary-hover` / `primary-foreground` | snow `#f7f8f8` / `#dcdee1` (darker) / void | ink `#111113` / `#2c2d32` (lighter) / white | The one primary action |
| `primary-text` | snow | ink | The primary as a mark ("Recommended", "You" steps) |
| `success` · `warning` · `danger` · `info` (+ `-subtle`, `-foreground`) | `#27a644` · `#e2a93b` · `#f07070` · `#4cc9d6` | `#1a7f4b` · `#8f5f00` · `#c62828` · `#0a6f7c` | Status dots, deltas, error text |
| `ring` | Mist `#d0d6e0` | ink | Focus outline — brightens, no extra hue |
| `scrim` | black 55% | ink 32% | Dialog and drawer backdrop |
| `on-danger` | void | white | Text on a solid danger fill (confirm button) |
| `select-chevron` | fog chevron | zinc chevron | Native select arrow, per theme |
| `shiki-token-*` | mist / lavender / mint / teal / ochre | darker steps | Syntax highlighting in docs code blocks (≥ 4.5:1 on `surface-2`) |
| `chart-1 … chart-6` | mist, teal, lavender, green, coral, fog | darker steps | Data series, in order (revenue is the neutral ink series) |

Elevation tokens: `shadow-ring` (inset hairline), `shadow-overlay` (floating
layers: the reference's inset highlight stack + hairline in dark, a soft drop in
light), `shadow-control` (the primary button only).

### 2.3 Contrast

Computed (WCAG 2.x) against every plane each token sits on:

| Pair | Dark | Light | Requirement |
| --- | --- | --- | --- |
| `foreground` | ≥ 16:1 | ≥ 17:1 | AAA |
| `foreground-secondary` | ≥ 11.8:1 | ≥ 10:1 | AAA |
| `muted-foreground` | ≥ 5.3:1 | ≥ 5.9:1 | AA |
| `faint-foreground` | ≥ 4.5:1 | ≥ 4.7:1 | AA — the floor, do not go quieter |
| status `-foreground` | ≥ 5.9:1 | ≥ 4.5:1 | AA |
| `primary-foreground` on `primary` | 18.7:1 (14.8:1 hover) | 18.9:1 (13.7:1 hover) | AAA |
| `chart-1` on its panel | 13:1 | 11.2:1 | ≥ 3:1 graphics |

Never encode meaning in colour alone: every status carries a label, every
delta carries a sign and an arrow icon.

---

## 3. Typography

**Inter Variable** for everything except numerals that must align or be quoted
verbatim; **JetBrains Mono** for those. Loaded via `next/font` (self-hosted, no
layout shift, no third-party request).

### Scale

This table **is** the scale. It is expressed as Tailwind tokens in
`src/design/theme.css`, so every step is a class. A size that is not on this
table does not exist: there is no `text-[13px]` in this codebase, and adding one
is a review comment.

Each token carries its own line-height, tracking and weight. Write
`text-caption`, not `text-caption leading-normal tracking-tight`.

| Token | Size | Line-height | Tracking | Weight | Used for |
| --- | --- | --- | --- | --- | --- |
| `text-micro` | 10 | 1.5 | — | 510 | numeric affixes, avatar initials |
| `text-label` | 11 | 1.4 | — | 400 | column headers, overlines |
| `text-meta` | 12 | 1.4 | — | 400 | table metadata, secondary chrome |
| `text-caption` | 13 | 1.5 | — | 400 | **the product default** (set on `body`): table cells, nav, buttons, page-bar titles |
| `text-ui` | 14 | 1.5 | −0.01em | 400 | empty-state and dialog headlines |
| `text-body-sm` | 15 | 1.6 | −0.011em | 400 | body copy in dense contexts |
| `text-body` | 16 | 1.5 | −0.01em | 400 | marketing body copy |
| `text-body-md` | 17 | 1.6 | — | 590 | body emphasis |
| `text-title` | 18 | 1.45 | −0.012em | 510 | a record's name on its detail page, dialog-sized titles |
| `text-body-lg` | 20 | 1.33 | −0.012em | 590 | lead paragraphs |
| `text-subheading` | 24 | 1.33 | −0.012em | 400 | auth titles, marketing card titles |
| `text-heading-sm` | 32 | 1.13 | −0.022em | 400 | headline metrics, mobile marketing headings |
| `text-heading` | 48 | 1.0 | −0.022em | 510 | marketing section headings |
| `text-heading-lg` | 64 | 1.0 | −0.022em | 510 | hero |
| `text-display` | 72 | 1.0 | −0.022em | 510 | reserved |

**Weights are 300 / 400 / 510 / 590.** `font-medium` is 510, `font-semibold` is
590. There is no bold: 590 is an *emphasis* weight, not a heading weight, and
700+ does not exist in this system.

Note the counter-intuitive part, which is deliberate and comes from the
reference: the **largest** headings (48–72) are 510, while the **mid** headings
(24–32) drop to 400. Size carries the hierarchy; weight does not have to.

**OpenType features are not optional.** `font-feature-settings: "cv01" on,
"ss03" on, "zero" on` is set on `body` in `theme.css`. Without those three
alternates the face is Inter, but it is not this system's Inter.

### Rules

- **590 is the heaviest weight in the system**, and it means emphasis, not
  heading. 700/800/900 do not exist here.
- Never restate a token's own line-height, tracking or weight next to it.
- Headings get *negative* tracking; micro-labels may take *positive* tracking
  when uppercased.
- All numerals in tables, KPIs and charts use `font-variant-numeric: tabular-nums`
  so columns align. This is non-negotiable in financial tables.
- Mono is for identifiers and machine values: `AFF-2034`, `TRX-92813`,
  `pk_live_…`, `wendel`, ISO timestamps.
- Currency headline figures use Inter with `tabular-nums`, not mono — mono is
  for *identity*, not for *magnitude*.
- Maximum measure for prose: 68ch.

---

## 4. Spacing

Strict **4px grid**. Allowed steps:

```
4  8  12  16  24  32  40  48  64  96
```

- Inside a control: 8 / 12.
- Between related elements: 12 / 16; a section's heading to its content 12 / 20.
- Between sections of a page: **40** (`space-y-10`), everywhere in the product —
  dashboard and portal alike. One rhythm, so pages do not drift between 32 and
  48. 24 (`space-y-6`) only inside a section that groups several blocks.
- Page gutter: 24 desktop, 16 mobile (owned by the shell, not by pages).
- Table cells: 12px horizontal, the first and last cell 4px so text aligns with
  the page gutter; rows are 48px.
- Never use arbitrary values like `p-[13px]`, `gap-[7px]`.

---

## 5. Radius

Three radii plus a badge and a pill are the entire vocabulary. Each is a token;
arbitrary values are banned, and so are Tailwind's own `rounded-lg` / `rounded-xl`,
because they say nothing about what the element *is*.

| Token | Radius | Element |
| --- | --- | --- |
| `rounded-hairline` | 2px | decorative marks, the logo glyph |
| `rounded-badge` | 4px | badge, tag, chip |
| `rounded-control` | 6px | button, input, select, icon tile |
| `rounded-panel` | 12px | card, dialog, popover, dropdown, table container |
| `rounded-full` | full | avatar, pill toggle |

12px is the **maximum**. `rounded-2xl`, `rounded-3xl` and `rounded-[30px]` are
banned — large radii read as consumer-app friendliness, which is the opposite of
what a ledger should project.

---

## 6. Borders & elevation

Depth is expressed by **surface contrast plus a hairline**, not by shadow.

- Default separation: `1px solid var(--border)`; rows inside a table use
  `border-faint`.
- Hover / emphasis: `border-strong`. Inputs brighten to `foreground-secondary` on focus.
- The content panel is `surface-1` + hairline + radius 12 on the canvas.
  Nothing inside it gets a resting shadow.
- A bordered panel (`Card`) is for **one** one-off container — a form, a chart,
  a callout. Lists, tables, metrics and empty states sit on the panel between
  hairlines.
- Only floating layers (menu, popover, tooltip, dialog, palette, toast) use
  `shadow-overlay`. The primary button alone carries `shadow-control`.
- Scrim: `bg-scrim`. No backdrop blur beyond 2px (sticky bars only).

### Stacking (z-index)

The scale in `src/design/theme.css` (`--z-index-*`) is the whole vocabulary;
`z-[90]` and friends are banned the same way `text-[13px]` is.

| Token | Value | Layer |
| --- | --- | --- |
| `z-base` | 0 | the page |
| `z-raised` | 10 | an in-flow lift: a control above a full-row link, a chart's hover card |
| `z-sticky` | 20 | the page header bar and other sticky bars inside the panel |
| `z-header` | 30 | the phone app bar, marketing and docs headers |
| `z-drawer` | 40 | the mobile navigation drawer and its scrim |
| `z-modal` | 50 | dialogs, the command palette, their scrims |
| `z-popover` | 60 | dropdowns, tooltips, popovers |
| `z-toast` | 70 | toasts |
| `z-skip` | 80 | the skip link while focused |

Floating layers sit **above** the drawer and the modal because they are
always opened from inside one: the account menu opened from the phone drawer,
a tooltip inside a dialog. A menu that renders behind the surface that opened
it is the bug this order exists to prevent.

---

## 7. Icons

**Lucide**, and only Lucide.

- Default size 16px, stroke 1.5. 14px inside dense table rows, 20px in the
  marketing hero only.
- Icons are `currentColor`. Never hard-code a colour on an icon.
- A decorative icon gets `aria-hidden="true"`. An icon that *is* the button gets
  an `aria-label` on the button.
- Never an icon-only button for a destructive action without a tooltip + label.

---

## 8. Motion

| Interaction | Duration | Easing |
| --- | --- | --- |
| Hover / colour change | 120ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Button press | 90ms | ease-out |
| Dropdown / popover / tooltip | 140ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Dialog | 180ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Sidebar collapse, tab indicator | 200ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Skeleton shimmer | 1600ms loop | linear |

Range is **120–220ms**. Nothing bouncy, nothing elastic, no spring overshoot, no
staggered entrance choreography. Transform + opacity only — never animate
`height`, `top` or `box-shadow`.

Everything above collapses to `0.01ms` under `prefers-reduced-motion: reduce`,
which is enforced globally in `src/design/theme.css`.

---

## 9. Components

Primitives live in `src/components/ui`, the frame in `src/components/layout`.

### Button

Variants: `primary` (monochrome solid, `shadow-control`, **one per view**), `secondary`
(transparent + hairline, text brightens on hover), `ghost` (text until hovered),
`danger` (hairline + danger text; tinted on hover), `destructive` (solid, only
inside the confirmation that states the consequence), `link`.
Sizes: `xs` 24px, `sm` 28px (page-bar actions), `md` 32px, `lg` 36px, `icon`
32px, `icon-sm` 28px. Radius 6, 13px medium, icon gap 6. Disabled at 40%.
Touch screens get a 36px minimum. Async buttons keep label and width and swap in
a spinner.

### Input / Select / Textarea

Height 32 (40 on phones and touch, with 16px text so iOS does not zoom).
`fill-subtle` well, `border` hairline, radius 6, placeholder `faint-foreground`.
Hover brightens the border to `border-strong`; focus to `foreground-secondary` —
no glow, no ring. Invalid: `aria-invalid` turns the border danger, and a message
below says why. Labels (`Field`) are 12px medium muted, bound with `htmlFor`.

### Card / Panel

`surface-1`, hairline, radius 12, padding 16. Header row 12px/16px padding,
13px medium title, optional hairline under it. Only for single containers — see §6.

### Table

The most important component in this product.

- **No container box.** `TableContainer` draws `border-y` only; the table sits
  on the panel. `bordered` restores a radius-12 frame for a table inside a grid
  next to other cards.
- Header: 36px, plain case, 13px `muted-foreground`, hairline below.
- Rows 48px, `border-faint` between, none after the last. Hover `bg-hover`.
  Clickable rows also expose a real link for keyboard and middle-click.
- Numeric columns right-aligned, `tabular-nums`, never wrap. Identifiers mono 12px.
- Every table ships four states: skeleton, empty, error, data.
- Sorted column header sets `aria-sort` and shows a 14px chevron.

### Badge

Height 20, radius 4, hairline, 12px medium **neutral** label, with a 6px status
dot in front. The dot lets a column of statuses be scanned; the label carries
the meaning. `tone="primary"` (strong hairline and ink text) is reserved for a mark
of identity, not a role or a status. `StatusDot` is the bare dot for chrome.

| Domain status | Tone |
| --- | --- |
| `active`, `approved`, `paid`, `available`, `connected` | success |
| `pending`, `draft`, `invited`, `hold` | warning |
| `reversed`, `rejected`, `cancelled`, `failed`, `suspended` | danger |
| `paused`, `archived`, `inactive`, `disconnected` | neutral |
| informational / provider labels | info |

### Metric (KPI)

A **hairline strip**, not tiles: `MetricGrid` is `border-y` with 2–3 columns,
`MetricCell` pads 16px vertically. Label (13px, muted, plain case) → value
(`text-title`, or `text-heading-sm` for the one headline figure; tabular, no
wrap) → delta (12px, success/danger with an arrow and a sign, plus the
comparison period muted).

### Page header

`PageHeader` is a sticky 48px bar across the content panel: 13px medium title
(or a breadcrumb ending in the title), optional muted `meta` (count, total),
actions on the right, then the page's one-line description below. It must be a
direct child of the page, not wrapped, or `sticky` has nothing to stick within.
`SectionHeader` titles blocks inside a page: 13px medium + muted count + one action.

### Dropdown / Tooltip / Popover

`surface-3`, `shadow-overlay`, radius 12 (tooltip 6), padding 4. Items 32px
(40 on touch), radius 6, `bg-selected` when highlighted, icons muted. Group
labels are 12px `faint-foreground`, plain case. 120ms pop-in.

### Dialog

`surface-3`, `shadow-overlay`, radius 12, max-width 480 (560 for forms). Header
with hairline below (14px medium title + muted description), body 16px padding,
footer with hairline above and actions on the right. Focus trap, `Esc` closes,
destructive dialogs state the consequence in plain language.

### Command palette

⌘K / Ctrl+K anywhere, or the search field in the sidebar. 640px, top 12vh,
`surface-3`. A combobox: the input keeps focus, ↑↓ move `aria-activedescendant`,
↵ runs, `Esc` closes and restores focus. Groups: *Go to* (every nav item with
its `G` chord), *Actions* (create, theme, language, sidebar, portal, sign out),
*Workspaces*. Only real shortcuts show a `Kbd`.

### Empty state

On the panel, no card: 40px icon tile (radius 12, hairline) → 14px medium
headline → one muted sentence (≤ 46ch) → one action. Never an illustration.

### Skeleton

Shapes match the real content's geometry — same row height, same columns, no
card around them. `fill` base with a 1600ms shimmer.

### Confirm dialog

`ConfirmDialog` guards every destructive or irreversible action: cancel a payout
batch, generate a new API key, disconnect Stripe. The trigger is a quiet `danger`
hairline button, never adjacent-and-equal to the primary action; the solid
`destructive` button exists only inside the dialog, on the right, next to a
neutral cancel that receives focus first. The description states the
consequence in plain language.

### Inline alert

`InlineAlert` is the one inline message style (form error, form success, page
notice): hairline box tinted by tone, icon, text. Use it instead of ad-hoc red
paragraphs. A form that shows its error inline does not also toast it
(`useActionResult(state, { toastOnError: false })`).

### Pagination, Term, FormSection

- `Pagination`: summary left, previous/next right; the caller passes typed
  `Link`s so filters survive; a missing link is a disabled button.
- `Term`: dotted underline + tooltip on hover and focus, for real jargon only —
  attribution window, first/last click, hold period, commission status.
- `FormSection`: one group of related fields in a form card — heading and a
  one-line description on the left, fields on the right from `md`.

### Route states

Every authenticated route group has `loading.tsx` (skeleton shaped like the page,
header bar included), `error.tsx` (translated, retry, way back) and
`not-found.tsx`. `[locale]/not-found.tsx` plus a catch-all serve the localised
404. No raw provider or database message ever reaches the page.

### Toast

Bottom-right (bottom-centre on mobile). Only for asynchronous, off-screen
outcomes. A form that can show inline success must not fire a toast.

---

## 10. Data visualisation

- Series colours are `--chart-1 … --chart-6`, used strictly in order.
- Revenue is always `--chart-1`; commission is always `--chart-2`. Keep these
  two consistent across every chart in the product.
- Grid: horizontal lines only, `border` colour, 1px. No vertical grid, no
  axis lines, no chart borders.
- Axis labels: 12px `muted-foreground`, abbreviated currency (`$18.4k`).
- Area fills are a 12% → 0% vertical gradient of the series colour.
- Tooltips: `surface-3` + `shadow-overlay`, radius 6, mono figures, 140ms fade. Show
  every series at the hovered x, sorted descending.
- Funnels show absolute value **and** conversion rate from the previous step.
- Charts are SVG rendered from pre-aggregated SQL. Never ship a chart library
  that pulls a thousand rows into the browser.
- Every chart has a table-shaped or text fallback for screen readers.

---

## 11. Layout

- **App shell** (`AppShell`, wrapped by `DashboardShell` and `AffiliateShell`):
  a 240px sidebar on the `background` plane — workspace switcher (or logo), the
  search field with ⌘K, grouped nav with 12px faint section labels, and settings
  plus the account menu pinned to the bottom. The page lives in **one inset
  content panel**: 8px from the viewport edges, `surface-1`, hairline, radius 12,
  scrolling on its own.
- Sidebar: collapsible to a 56px icon rail with `[` (persisted per browser);
  always a rail from 768 to 1024px; below 768px an app bar (menu, brand, search)
  opens it as a drawer.
- Content: 24px gutter (16 on phones), every block centred at `max-w-content`
  (1280px); detail pages may narrow to `max-w-detail` (880px). The page header
  bar is full-bleed across the panel.
- The account menu carries theme and language, which have no page of their own.
- Marketing: 1200px max-width (`max-w-page`), 24px gutter, 80–112px section
  rhythm. The landing is a sales narrative in a fixed order — hero, click →
  commission flow, problem, how it works, product stories, founder/affiliate
  sides, integrations, principles, pricing preview, FAQ, closing CTA — and its only
  imagery is the product, rebuilt from tokens in
  `(marketing)/_components/visuals.tsx`. One primary action per viewport; mock
  buttons inside visuals are secondary. Claims must be true in the code
  (Stripe only; no invented customers, logos or numbers).
- Search-intent pages (`/pt-br/programa-de-afiliados-saas` and siblings,
  `features/marketing/content-page.tsx`): same marketing frame. Breadcrumb,
  eyebrow pill, one H1 (`text-heading-sm` → `text-heading`, never
  `heading-lg`, which stays the landing hero's), lead, primary + secondary
  CTA. Below a hairline, the article (H2 = `text-subheading` per section,
  prose `text-body-sm`/`text-body` capped at `max-w-reading`) and, from `lg`,
  a sticky 14rem "Neste guia" outline. Blocks: prose, a points grid (hairline
  on top, H3 `text-ui`), numbered steps in one panel, a comparison table that
  scrolls inside its own focusable region below 672px, and a closing note in
  muted text. Then the FAQ (visible, H3 per question), a "Continue lendo" row
  of three linked cards, and the closing CTA panel. Server-rendered only — no
  client component on these pages. Copy is product-specific and verifiable;
  the H1 names the category, the brand stays in the navbar.
- Docs: own route group. Docs bar (brand / Docs, language, theme, Painel, one
  primary sign-up), then at `max-w-docs` (1440px) a sticky section sidebar
  (14rem) · content column (`max-w-detail`, 880px; running text capped at
  `max-w-reading`, 720px, so code and tables get the width, prose keeps its
  measure) · "Nesta página" outline (13rem, from `xl`); below `lg` the sidebar
  is a drawer. Every H2/H3 is anchored with a hover copy-link. The "Como
  funciona" flow has an owner legend (Seu SaaS / Refvia) and turns from
  rows into five columns only when its container is ≥ 768px. Code samples use
  `CodeBlock`/`CodeTabs` (Shiki at build time, `--shiki-token-*` colour tokens
  per theme, language label and copy in every header), identifiers
  in prose use `InlineCode`, and `Callout` (info/success/warning/danger) is
  rationed. Compact footer. No search box until search exists.
- Auth: from 1024px a split — product statement and a decorative
  click → commission proof on the canvas, the form on `surface-1` behind a
  hairline; below, one column. Login, sign-up, check-your-e-mail, forgot and
  reset password share it.
- Integrations: four link tabs under the page header — Visão geral ·
  Pagamentos · Rastreamento · API — instead of sidebar items. Overview: a
  four-cell hairline strip (tracker, customer identity, providers, health; a
  status dot + a sentence each), the setup checklist (steps tick themselves off
  from evidence, a quiet `AutoRefresh` re-reads the page while something is
  awaited), the multi-select "how do you get paid?" as real checkboxes styled as
  cards, the connection cards, and "test the integration". A provider is a
  neutral monogram tile + its name (no provider logos until each brand's
  guidelines are cleared). A connection card is one link: provider, account
  name · mode, one health badge, the last event or the first issue — never a
  client id, webhook id or secret. The detail page reads top-down: status,
  "needs attention" (what happened / what it affects / what to do, one block
  per issue), stages, latest payments with their pipeline (dots + labels,
  organic payments neutral, never red), recent events, capabilities ("—" for
  what the provider cannot do), then a folded "Configurações avançadas" with
  identifiers, endpoint, rename, key rotation and disconnect (its confirm dialog
  states that the ledger is kept). Nothing turns green until the backend says
  so; a pending action names the real step it is waiting on.
- Onboarding: canvas, slim top bar, a three-step stepper (Workspace → Programa
  → Pronto) and progressive disclosure for expert settings; "Pronto" is the
  activation checklist on the overview.

## 11b. Keyboard

| Keys | Action |
| --- | --- |
| ⌘K / Ctrl+K | Open or close the command palette |
| `G` then `O` `P` `A` `C` `M` `Y` `I` `S` | Overview, Programs, Affiliates, Conversions, Commissions, Payouts, Integrations, Settings |
| `G` then `O` `L` `C` `M` `Y` `S` | Affiliate portal: Overview, Links, Conversions, Commissions, Payouts, Settings |
| `[` | Collapse / expand the sidebar |

Chords never fire while typing in a field or while a dialog or menu is open.
Adding a nav item means adding its chord, or deliberately none.

---

## 12. Accessibility

Non-negotiable:

- Semantic HTML first: `<table>`, `<th scope>`, `<nav>`, `<main>`, `<button>`.
- Visible `:focus-visible` outline on every interactive element — 2px `--ring`,
  1px offset. Inputs replace it with a brightened border. Never `outline: none`
  without a replacement.
- Full keyboard reachability; logical tab order; skip-to-content link.
- Dialogs and sheets trap focus and restore it to the trigger on close.
- Every icon-only control has an accessible name.
- Live regions (`aria-live="polite"`) for async results and toasts.
- Colour is never the sole carrier of meaning.
- Respect `prefers-reduced-motion` and `prefers-contrast`.
- Target size ≥ 32×32 on desktop, ≥ 44×44 for primary mobile actions.

---

## 13. Responsive behaviour

Breakpoints: `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1536.

**Founder dashboard** is desktop-first but must be fully usable on tablet and
phone. **Affiliate portal is mobile-first** — affiliates check earnings on a
phone. Its home screen must be readable, tappable and complete at 375px.

Table strategy by context:

| Context | < `md` behaviour |
| --- | --- |
| Financial tables the founder scans (commissions, transactions) | horizontal scroll with a sticky first column and a visible edge fade |
| Entity lists (affiliates, programs, payouts) | collapse each row into a card: title + status on line 1, two key metrics on line 2, the rest behind a detail link |
| Affiliate portal lists | always stacked items, never scroll |

The shell itself: sidebar ≥ 1024px, icon rail 768–1024px, app bar + drawer
below 768px.

---

## 14. Do / Don't

```
DO    <TableContainer><Table>…</Table></TableContainer>   (on the panel, border-y)
DON'T <Card><TableContainer>…</TableContainer></Card>

DO    <PageHeader title="Comissões" meta="34" actions={<Button variant="primary" size="sm">…} />
DON'T <h1 className="text-heading-sm">Comissões</h1> plus a row of buttons

DO    <StatusBadge status="pending" />      (dot + neutral label)
DON'T <span className="text-warning">Pending</span>

DO    <MetricGrid><MetricCell><Metric …/></MetricCell>…</MetricGrid>
DON'T three bordered KPI cards in a grid

DO    text-caption font-medium            (13px bar title)
DON'T text-2xl font-bold

DO    <td className="text-right tabular-nums">{formatMoney(1470,'USD')}</td>
DON'T <td>{(14.7).toFixed(2)}</td>

DO    one primary action per view
DON'T three solid primary buttons competing in one header

DO    bg-hover / bg-selected / bg-fill       (theme-safe alpha tokens)
DON'T bg-white/5                            (invisible in light)

DO    transition-colors duration-[120ms]
DON'T transition-all duration-500 ease-bounce
```
