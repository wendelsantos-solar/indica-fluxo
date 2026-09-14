# DESIGN.md

The single source of truth for the visual language of this product.
**Read this file before creating or altering any interface.**

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

Declared in `src/design/tokens.css`.

```
--black-950  #08090a    --lime-300  #eef94f
--black-900  #0f1011    --lime-400  #e4f222   ← accent
--gray-850   #161718    --lime-500  #c4d10c
--gray-800   #1c1d1f    --lime-600  #9aa50a
--gray-750   #23252a
--gray-700   #383b3f    --green-500 #3fb950
--gray-500   #6b7078    --amber-500 #d8a13a
--gray-400   --8a8f98   --red-500   #f2555a
--gray-200   #d0d6e0    --blue-500  #4ea7fc
--white      #ffffff
```

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
background            #08090a
surface-1             #0f1011
surface-2             #161718
surface-3             #1c1d1f
border                #23252a
border-strong         #383b3f
foreground            #ffffff
foreground-secondary  #d0d6e0
muted-foreground      #8a8f98
primary               #e4f222
primary-foreground    #14160a
success               #3fb950
warning               #d8a13a
danger                #f2555a
info                  #4ea7fc
```

Subtle status fills in dark are the hue at ~14% alpha over the surface, never a
flat tint, so they survive on `surface-1` and `surface-2` alike.

### 2.5 Light theme

Light is **not** "white background, black text". It is the same system with the
planes inverted in depth order: the canvas is a cool off-white and elevated
surfaces are *lighter* (pure white), which keeps the "raised" metaphor intact.

```
background            #f7f8f8
surface-1             #ffffff
surface-2             #f2f3f5
surface-3             #ffffff
border                #e4e6e9
border-strong         #c6cad0
foreground            #0c0d0e
foreground-secondary  #3c4149
muted-foreground      #6a6f78
primary               #d2e016     (darkened lime, for edge definition on white)
primary-foreground    #14160a
success               #1a7f37
warning               #9a6b00
danger                #cf2f36
info                  #1668c4
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

| Role | Size / line-height | Weight | Tracking |
| --- | --- | --- | --- |
| Display | 64–72 / 1.0 | 500 | −0.035em |
| H1 | 48 / 1.05 | 500 | −0.03em |
| H2 | 32 / 1.15 | 500 | −0.025em |
| H3 | 24 / 1.25 | 500 | −0.02em |
| H4 / section | 18 / 1.35 | 500 | −0.01em |
| Body | 16 / 1.6 | 400 | 0 |
| Body small | 14 / 1.55 | 400 | 0 |
| Label | 13 / 1.4 | 500 | 0 |
| Micro / table header | 12 / 1.3 | 500 | +0.02em, uppercase |
| Mono | 13 / 1.4 | 450 | 0, `tabular-nums` |

### Rules

- **500 is the heaviest weight in the product UI.** 600 is allowed only on the
  marketing display headline. 700/800/900 are never used.
- Headings get *negative* tracking; micro-labels get *positive* tracking.
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

| Element | Radius |
| --- | --- |
| Badge, tag, chip | 4px |
| Button, input, select, small control | 6px |
| Card, panel, dialog, popover, table container | 12px |
| Avatar, pill toggle | full |

`rounded-3xl`, `rounded-[30px]` and friends are banned.

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
