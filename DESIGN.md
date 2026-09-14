# DESIGN.md

The single source of truth for the visual language of this product.
**Read this file before creating or altering any interface.**

---

## 0. Provenance

The visual language is derived from a published style reference, vendored at
`docs/linear-style-reference.md`. That file is the *source*; this file is the
*system*. When they disagree, this file wins, because it carries the four things
the reference does not cover: a light theme, functional status colour, the sub-13px
rungs a financial table needs, and accessibility floors.

Deviations from the reference, all deliberate:

| Deviation | Why |
| --- | --- |
| A light theme exists | The reference is dark-only. CLAUDE.md's definition of done requires light and dark per feature. Light is derived from the same ramp read in the other direction, not invented. |
| Supporting chroma is used for status | The reference calls green/red/teal/violet decorative and says not to use them as status. This is a ledger: "reversed" versus "paid" must be legible at a glance. The hues are kept; the role is not. |
| `caption` (13px) is line-height 1.5, not 1.2 | The reference's named export says 1.2, but its own token dump carries 13px at both 1.5 and 1.2. 1.2 suits a single-line nav item and breaks a two-line table description, which is most of this product. |
| Steps below 13px exist (`micro`, `label`, `meta`) | The reference describes a marketing site. A dense table needs rungs its scale does not have. |
| Amber | The reference has no warning hue. Tuned to sit between the lime and the coral without competing with either. |

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
- `rounded-3xl` on everything.
- Emoji as UI iconography.
- A dashboard that is a 4×3 grid of identical KPI cards.
- Stock photography or generic SaaS illustrations.
- Hex colours written inline: `bg-[#08090a]`.

---

## 2. Colour

### 2.1 Rules

- Components consume **semantic tokens only** (`bg-surface-1`, `text-muted-foreground`).
- Primitives (`--lime-400`, `--gray-800`) exist only inside `src/design/tokens.css`
  to define semantics. Never reference a primitive in a component.
- **The lime accent is rationed.** One chromatic primary action per view.
  A dashboard with three lime buttons is a bug.
- Status colour is reserved for status. Never use `success` green just because
  a number is "nice".

### 2.2 Primitives

Declared in `src/design/tokens.css`. They carry the reference's own names so a
future comparison against it is a lookup, not a translation.

**Neutral ramp** — one ramp, both themes. Dark reads it bottom-up, light top-down.

```
--color-void       #08090a   canvas (dark)
--color-carbon     #0f1011   card surface (dark)
--color-obsidian   #161718   elevated panel (dark)
--color-graphite   #23252a   hairline border (dark)
--color-smoke      #383b3f   emphasised border (dark)
--color-ash        #62666d   muted text (light)
--color-fog        #8a8f98   muted text (dark)
--color-mist       #d0d6e0   secondary text (dark)
--color-bone       #e5e5e6   hairline border (light)
--color-paper      #ffffff   primary text (dark) / card surface (light)
```

**Light extensions** — not in the reference; they give light mode the same
number of surface steps the dark ramp has.

```
--color-chalk      #eceef0
--color-porcelain  #f4f5f6
--color-quartz     #f8f9f9
```

**Accent** — the one chromatic action colour in the system.

```
--color-acid-lime         #e4f222   ← the accent
--color-acid-lime-bright  #eef94f   dark-mode hover
--color-acid-lime-deep    #c2cf10   light-mode fill, so it reads as a control on white
```

**Supporting chroma** — reference hues, used functionally (see §0).

```
--color-pulse-green  #27a644    --color-iris-violet  #6366f1
--color-coral-red    #eb5757    --color-lavender     #8b5cf6
--color-signal-teal  #02b8cc    --color-amber        #d8a13a  (extension)
```

Each has a `-light` step for chromatic text on dark and a `-deep` step for the
same problem on white, because a single hue cannot clear 4.5:1 against both.

### 2.3 Semantic tokens

Every one of these is defined for **both** themes. If you add a token, add it twice.

| Token | Meaning |
| --- | --- |
| `--background` | Page canvas. The furthest-back plane. |
| `--foreground` | Primary text. |
| `--foreground-secondary` | Secondary text still meant to be read. |
| `--muted` | Quiet fill (table header, disabled input). |
| `--muted-foreground` | Labels, metadata, timestamps, column headers. |
| `--surface-1` | Cards, panels, the sidebar. One step up from canvas. |
| `--surface-2` | Nested panels, hovered rows, inputs. |
| `--surface-3` | Popovers, dropdowns, tooltips, dialogs. |
| `--border` | Default hairline. |
| `--border-strong` | Emphasised separation, focused input. |
| `--primary` / `--primary-foreground` | The single chromatic call to action. |
| `--success` / `--success-subtle` / `--success-foreground` | Paid, active, positive delta. |
| `--warning` / `--warning-subtle` / `--warning-foreground` | Pending, hold period, attention. |
| `--danger` / `--danger-subtle` / `--danger-foreground` | Refund, reversed, destructive, error. |
| `--info` / `--info-subtle` / `--info-foreground` | Neutral informational state. |
| `--ring` | Focus ring. |
| `--chart-1 … --chart-6` | Data visualisation series, in order of use. |

### 2.4 Dark theme (the primary experience)

```
background            void       #08090a
surface-1             carbon     #0f1011
surface-2             obsidian   #161718
surface-3             graphite   #23252a
border                graphite   #23252a
border-strong         smoke      #383b3f
foreground            paper      #ffffff
foreground-secondary  mist       #d0d6e0
muted-foreground      fog        #8a8f98
primary               acid-lime  #e4f222
primary-foreground    void       #08090a
success               #4ecb6b    warning  #e6b862
danger                #ff8084    info     #4cc9d6
```

Subtle status fills are the base hue at ~20% alpha over the surface, never a
flat tint, so they survive on `surface-1` and `surface-2` alike.

### 2.5 Light theme

Light is **not** "white background, black text". It is the same ramp read from
the other end: the canvas is a cool off-white and elevated surfaces are
*lighter* (pure white), which keeps the "raised" metaphor intact.

```
background            quartz     #f8f9f9
surface-1             paper      #ffffff
surface-2             porcelain  #f4f5f6
surface-3             paper      #ffffff
border                bone       #e5e5e6
border-strong         #c6cad0
foreground            void       #08090a
foreground-secondary  #3c4149
muted-foreground      ash        #62666d
primary               acid-lime-deep  #c2cf10   (so the fill reads as a control on white)
primary-foreground    void       #08090a
success               #14622c    warning  #7a5400
danger                #c0292e    info     #0a6f7c
```

Typography, density, radii, spacing and component anatomy are **identical**
across themes. Only colour changes.

### 2.6 Contrast

| Pair | Ratio | Requirement |
| --- | --- | --- |
| `foreground` / `background` | ≥ 15:1 | AAA body |
| `foreground-secondary` / `background` | ≥ 7:1 | AAA body |
| `muted-foreground` / `background` | ≥ 4.5:1 | AA body — this is the floor, do not go quieter |
| `primary-foreground` / `primary` | ≥ 12:1 | AAA |
| status fg / its subtle bg | ≥ 4.5:1 | AA |
| `border` / adjacent surface | ≥ 1.4:1 | perceivable hairline |

Never encode meaning in colour alone: every status badge carries a label, every
delta carries a sign or an arrow icon.

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
| `text-caption` | 13 | 1.5 | — | 400 | **the workhorse**: table cells, descriptions, nav |
| `text-ui` | 14 | 1.5 | −0.01em | 400 | form fields, buttons |
| `text-body-sm` | 15 | 1.6 | −0.011em | 400 | body copy in dense contexts |
| `text-body` | 16 | 1.5 | −0.01em | 400 | marketing body copy |
| `text-body-md` | 17 | 1.6 | — | 590 | body emphasis |
| `text-body-lg` | 20 | 1.33 | −0.012em | 590 | lead paragraphs |
| `text-subheading` | 24 | 1.33 | −0.012em | 400 | card titles, in-product page titles |
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
4  8  12  16  24  32  48  64  96
```

- Inside a control: 8 / 12.
- Between related elements: 12 / 16.
- Between sections of a page: 32 / 48.
- Page gutter: 24 desktop, 16 mobile.
- Table cell padding: `px-16 py-12` equivalent (`px-4 py-3`).
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

- Default separation: `1px solid var(--border)`.
- Emphasised / focus: `var(--border-strong)`.
- Cards sit on the canvas as `surface-1` + hairline. No shadow.
- Only genuinely floating layers (dropdown, popover, dialog, toast) may use a
  shadow, and only the tokenised `--shadow-overlay`, which is a tight, low-alpha
  shadow — not a glow.
- Dialog scrim: `oklch(0 0 0 / 0.6)` in dark, `oklch(0 0 0 / 0.35)` in light.
  No backdrop blur beyond 2px.

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

### Button

Variants: `primary` (the lime one — one per view), `secondary` (surface-2 +
border), `ghost` (transparent, hover surface-2), `danger` (danger-subtle fill,
danger text; solid danger only inside a confirmation dialog), `link`.
Sizes: `sm` 28px, `md` 32px, `lg` 40px. Radius 6. Icon gap 8 (6 at `sm`).
Every button has a `:focus-visible` ring and a disabled state at 50% opacity
with `cursor: not-allowed`. Async buttons swap the leading icon for a spinner
and keep their label and width.

### Input / Select / Textarea

Height 32 (`md`) / 36 (`lg`). `surface-2` fill, `border` hairline, radius 6.
Focus: `border-strong` + 2px `ring` at 35% alpha, no glow. Error: `danger`
border and a message below in `danger` — never colour alone, always text.
Labels are always real `<label>` elements bound with `htmlFor`.

### Card / Panel

`surface-1`, hairline border, radius 12, padding 24 (16 on mobile). Optional
header row: title (H4) left, actions right, separated by a hairline when the
body is a list or table.

### Table

The most important component in this product.

- Wrapped in a radius-12 bordered container; the table itself is borderless.
- Header: `surface-2` fill, 12px uppercase `muted-foreground` with +0.02em
  tracking, sticky when the container scrolls.
- Row height 48. Hairline `border` between rows, none after the last.
- Row hover: `surface-2`, 120ms. Clickable rows get `cursor: pointer`, a focus
  ring, and must also expose a real link for keyboard/middle-click.
- Numeric columns are right-aligned and `tabular-nums`. Currency shows the
  symbol once per cell.
- Identifier columns use mono at 13px.
- Every table ships four states: skeleton, empty, error, and data.
- Sorted column header shows a 14px chevron and sets `aria-sort`.
- Never horizontal-scroll a table without a visible affordance.

### Badge

Radius 4, height 20, 12px text, `px-2`. Subtle status fill + status foreground.
Status vocabulary is fixed:

| Domain status | Token |
| --- | --- |
| `active`, `approved`, `paid`, `available` | success |
| `pending`, `draft`, `hold` | warning |
| `reversed`, `rejected`, `cancelled`, `failed` | danger |
| `paused`, `archived`, `inactive` | muted |
| informational / provider labels | info |

### Metric (KPI)

Label (12px, muted, uppercase) → value (32–48px, tabular-nums) → delta
(13px, success/danger with `▲`/`▼`, plus the comparison period in muted text).
A metric without a comparison period is a missed opportunity, not a feature.

### Dialog

Radius 12, `surface-3`, max-width 480 (560 for forms). Focus trap, `Esc` closes,
scrim click closes unless the form is dirty. Destructive dialogs put the
destructive button on the right and state the consequence in plain language
("This will mark 12 payout items as paid. This cannot be undone.").

### Empty state

Icon (20px, muted, in a 40px `surface-2` rounded square) → headline (16/500) →
one sentence of explanation (14, muted, ≤ 2 lines) → one primary action.
Never an illustration. Never more than one action.

### Skeleton

Shapes must match the real content's geometry — same height, same radius, same
column widths. `surface-2` base with a 1600ms shimmer. Never a spinner where a
skeleton can be drawn.

### Toast

Bottom-right (bottom-centre on mobile). Only for *asynchronous, off-screen*
outcomes ("Payout batch marked as paid", "Stripe disconnected"). A form that can
show inline success must not fire a toast. Never a toast for a navigation.

---

## 10. Data visualisation

- Series colours are `--chart-1 … --chart-6`, used strictly in order.
- Revenue is always `--chart-1`; commission is always `--chart-2`. Keep these
  two consistent across every chart in the product.
- Grid: horizontal lines only, `border` colour, 1px. No vertical grid, no
  axis lines, no chart borders.
- Axis labels: 12px `muted-foreground`, abbreviated currency (`$18.4k`).
- Area fills are a 12% → 0% vertical gradient of the series colour.
- Tooltips: `surface-3` + hairline, radius 6, mono figures, 140ms fade. Show
  every series at the hovered x, sorted descending.
- Funnels show absolute value **and** conversion rate from the previous step.
- Charts are SVG rendered from pre-aggregated SQL. Never ship a chart library
  that pulls a thousand rows into the browser.
- Every chart has a table-shaped or text fallback for screen readers.

---

## 11. Layout

- App shell: fixed 240px sidebar (collapses to 56px icon rail below `lg`, becomes
  a sheet below `md`), sticky 56px top bar, scrollable content.
- Content max-width 1400px, centred, 24px gutter.
- Page header: breadcrumb/title left, primary action right, 32px below.
- Marketing: 1200px max-width, 24px gutter, 96–128px section rhythm.

---

## 12. Accessibility

Non-negotiable:

- Semantic HTML first: `<table>`, `<th scope>`, `<nav>`, `<main>`, `<button>`.
- Visible `:focus-visible` ring on every interactive element — 2px `--ring`,
  2px offset. Never `outline: none` without a replacement.
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
| Affiliate portal lists | always cards, never scroll |

---

## 14. Do / Don't

```
DO    className="bg-surface-1 border border-border rounded-xl"
DON'T className="bg-[#0f1011] shadow-xl rounded-3xl"

DO    <Badge tone="warning">Pending</Badge>
DON'T <span className="text-yellow-400">●</span>

DO    text-2xl font-medium tracking-tight
DON'T text-2xl font-bold

DO    <td className="text-right tabular-nums">{formatMoney(1470,'USD')}</td>
DON'T <td>{(14.7).toFixed(2)}</td>

DO    one lime primary action per view
DON'T three lime buttons competing in one header

DO    a skeleton shaped like the table it replaces
DON'T a centred spinner on an empty page

DO    transition-colors duration-120
DON'T transition-all duration-500 ease-bounce
```
