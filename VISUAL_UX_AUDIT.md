# Visual & UX audit

Date: 2026-09-16. Scope: every route in `src/app/[locale]`, desktop (1440) and
phone (375), light and dark. Method: headless Chrome screenshots of the running
dev server plus a static scan of the source against `DESIGN.md`.

Severity: **P0** usability broken · **P1** evident visual/UX problem ·
**P2** noticeable inconsistency · **P3** micro-polish.

## Status

| Phase | State |
| --- | --- |
| Public routes (landing, pricing, login, sign-up, forgot password, docs) | Inspected before and after, both themes, desktop and phone |
| Authenticated routes (onboarding, dashboard, affiliate portal) | **Pending visual pass.** Needs a signed-in session in the browser pane; the agent does not type passwords. Static scan done, fixes below apply to them through shared components |

## Layout system (already canonical, one gap fixed)

The structure was already centralised; no page sets its own gutter or outer width:

| Piece | Owner | Value |
| --- | --- | --- |
| Page gutter | `AppShell` / `FocusFrame` content column | 16px phone, 24px from `md` |
| Content axis | same column, every direct child except the header bar | `mx-auto max-w-content` (1280px) |
| Detail / form width | page body | `max-w-detail` (880px), left-aligned on the content axis |
| Page header | `PageHeader` → `PageHeaderBar` | sticky 48px bar, full-bleed border, row on the content axis |
| Section rhythm | pages | `space-y-10` between sections |
| Marketing | `max-w-page` (1200px), docs `max-w-docs` (1440px) | |

## Findings

| Route | Issue | Severity | Recommendation | Status |
| --- | --- | --- | --- | --- |
| Global | Signal amber was the colour of every primary CTA, the logo stroke, "Recommended"/"You" marks and the revenue chart series — yellow meant "important" rather than "warning" | P1 | Monochrome primary through tokens: ink/white on light, snow/void on dark; amber stays only as `warning` | Fixed (`tokens.css`, `DESIGN.md` §0, §2, §9) |
| All dashboard, portal and onboarding pages | Header row was full-bleed while the body is centred at 1280px: on viewports wider than ~1570px the title and actions sit on the panel edge, up to ~170px left of the table/heading below | P2 | Keep the bar's border and fill full-bleed; put its row on the `max-w-content` axis | Fixed in `PageHeaderBar` — **verify visually at 1920** |
| All route skeletons | The sticky header bar was re-implemented by hand in 5 loading files plus `page-skeleton`, so loading and loaded frames could drift | P2 | One `PageHeaderBar` shared by `PageHeader` and every skeleton | Fixed (consolidated) |
| Landing `/` | Product mock's "Convidar afiliado" rendered as a primary button, competing with the hero CTA (DESIGN §11: mock buttons are secondary) — with a black primary it would read as a second real CTA | P2 | Secondary variant | Fixed |
| Dashboard overview (chart), landing visual | Revenue series `chart-1` was the old accent amber | P2 | Neutral ink series (mist dark / zinc-800 light), commission keeps teal | Fixed |
| OpenGraph image | Amber accent bar | P3 | Primary ink (snow) | Fixed |
| Code comments (15 files) | "The one amber action…" no longer true | P3 | Say "primary" | Fixed |
| Pricing `/precos` | "Recomendado" badge amber | P3 | `tone="primary"` now resolves to strong ink hairline | Fixed via token |
| Docs `/documentacao` | "Você" step tags amber | P3 | Same token | Fixed via token |
| Unknown URL, signed out (`/pt-br/nao-existe`) | Redirects to login instead of the localised 404 — the catch-all is treated as a workspace slug | P3 | Decide in routing whether unknown single-segment paths should 404 before auth | Open (routing behaviour, not visual) |
| Landing, phone | Hero reassurance list wraps 2 + 1 | P3 | Acceptable; stacking all three would add height above the fold | No change |
| Docs, phone | Menu button on the left while marketing puts it on the right | — | Intentional: docs menu opens the section sidebar, like the app shell | No change |
| Auth split (desktop) | Left statement and right form centre on the same axis with different heights | — | Checked: both halves share header/footer height and centre on one baseline | No change |

## Static scan (whole `src`)

| Check | Result |
| --- | --- |
| `dark:` variants in components | 0 |
| Inline hex (`bg-[#…]`), `text-[Npx]`, `rounded-lg/xl/[…]`, `bg-white`/`bg-black` | 0 |
| Files with more than one primary button | Only where they are mutually exclusive (empty state vs populated header, dialog footers, wizard steps) |

## Remaining (needs the authenticated pass)

Overview, programs, program detail, new program, affiliates, affiliate detail,
conversions, conversion trail, commissions, payouts, payout batch, integrations,
settings, onboarding, and the affiliate portal (overview, links, conversions,
commissions, payouts, settings): alignment at 1024/1440/1920, toolbars, empty
states, dialogs, tables, phone layouts, light and dark.
