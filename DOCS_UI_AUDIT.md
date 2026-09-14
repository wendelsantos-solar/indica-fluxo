# Docs UI audit — `/pt-br/documentacao` · `/en/docs`

## 1. Before

The page lived in the marketing layout: landing navbar, a `max-w-reading` column
centred on a wide canvas, `py-24/py-32` of empty space above the title, four
numbered blocks (title, one paragraph, a `<pre>` box) and the full marketing
footer.

| Area | Problem |
| --- | --- |
| Structure | Read as "technical content inside a landing page": no sidebar, no outline, no anchors, no way to jump to a step or share a link to one |
| Space | ~200 px of vertical padding before the H1; a 720 px column on a 1440 px screen left ~700 px unused |
| Hierarchy | H1 at 48 px (marketing scale); every section the same weight; details (cookie name, SameSite, lifetime) packed into one paragraph |
| Code | Plain `<pre>` boxes: no language label, no copy button, no highlighting, sample host `app.example.com` |
| Inline code | Code-like words (`?ref=`, `_referral_id`, `invoice.payment_succeeded`) set as normal prose |
| Webhook events | Five event names inside a sentence |
| Commission | A monospace box `base 4900 / rate 3000 / result 1470` with no human-readable figure |
| Security | "Never from the browser" in running text, same weight as everything else |
| Completeness | No prerequisites, no way to verify the result, no keys explanation, no API reference, no error codes, no explanation of `visitorId` (see `DOCS_TECHNICAL_FINDINGS.md` T2) |
| Content storage | Section bodies rendered with `t.raw` because `</head>` broke ICU |
| Mobile | Worked, but was the same long single column with nothing to navigate by |

## 2. After — what changed

- **Own route group `(docs)`** with a docs layout: docs bar, the page, a compact footer. The URL is unchanged.
- **Three-column documentation layout** (≥ 1280 px): section sidebar (14rem, sticky, own scroll) · reading column (max 48rem) · "Nesta página" (12rem, sticky). 1024–1279 px drops the outline; below 1024 px the sidebar becomes a drawer.
- **Docs bar**: `IndicaFluxo / Docs`, language, theme, Painel, Criar conta. **No search box** — search does not exist, so none is shown.
- **Compact entry**: breadcrumb, H1, one-line lead, a checked outcome line.
- **Quickstart narrative** in five numbered steps (install tracker → identify → Stripe → commission → verify), preceded by "Como funciona" (five-moment flow with who does what) and "Antes de começar" (real prerequisites).
- **Concepts** (attribution window, first click, last click, hold period), **Security** (publishable vs secret key cards), **Reference** (identify API table, Stripe events table, error codes table).
- **Anchors on every H2/H3**, translated like pathnames (`#instalar-tracker` / `#install-tracker`); a link icon appears on hover/focus (always visible on touch) and copies the section URL, confirmed in place.
- **Scroll-spy** shared by the sidebar and the outline (last heading above 25 % of the viewport; the last section wins at the bottom; recomputed after restoration and hash jumps).
- **Compact footer**: logo, copyright, Site · Preços · Painel. No privacy/terms links — those pages do not exist.
- **SEO**: title "Guia de integração · IndicaFluxo" (the product's existing title template), description, canonical, `hreflang`, OpenGraph `article`. One H1.

## 3. Layout decisions

| Decision | Why |
| --- | --- |
| Separate `(docs)` group instead of the marketing layout | Docs need a working bar (dashboard, sign-up) and a compact footer; the landing's nav and five-group footer are sales chrome |
| `max-w-docs` token (1440 px) | Sidebar + 48rem column + outline need more than `max-w-page` (1200 px); added to `theme.css` rather than an arbitrary width |
| Reading column 48rem | Long enough for code samples without horizontal scroll in most cases; prose stays near 75 characters |
| Outline only from `xl` | Between 1024 and 1280 px a third column squeezes the code blocks; the sidebar already gives navigation |
| Single page, anchors only | The guide is one continuous task; `features/docs/structure.ts` already groups sections so a group can become a route later. No previous/next pagination is rendered because there is no next page |
| Type | H1 `text-heading-sm` (32 px) — the scale has no 36–44 px step and adding one for one heading was not justified; H2 `text-subheading` (24), H3 `text-title` (18), body `text-body-sm` (15/1.6) |
| Sections separated by `border-border-faint` hairlines and 40 px | Continuous reading instead of four pasted pages |

## 4. Code blocks

- **`CodeBlock`** (server component): header with file name and/or language label and a copy button, then the code on `surface-2` with a hairline and panel radius; horizontal scroll inside the block only; focusable `<pre>` for keyboard scrolling.
- **Highlighting: Shiki, server-side only.** Fine-grained imports (`shiki/core`, JavaScript regex engine — no WASM — and six grammars: HTML, JavaScript, TypeScript, JSON, Bash, plain text). The page is statically generated, so highlighting runs at build time and ships **no highlighting JavaScript**.
- **Colours are tokens**: a Shiki css-variables theme; `--shiki-token-*` are defined for both themes in `tokens.css` (low-saturation; every token ≥ 4.5:1 on `surface-2` — dark 4.7–12.3, light 4.6–10.2).
- **Copy** reuses the product's `CopyButton` (Clipboard API with a selection fallback), feedback "Copiado" in the button itself, no toast.
- **`CodeTabs`**: cURL | TypeScript (plain `fetch`, server-side) for identify — both real. No framework/SDK tabs, because no SDK exists.
- **Snippets are code, not copy**: `features/docs/snippets.ts` builds them from the constants the API uses (tracker path, cookie, schema, event list, `applyBasisPoints`), with the deployment's real origin. `features/docs/__tests__/snippets.test.ts` checks: the tracker attribute is the one the script reads; the identify example parses against the real schema (both cURL and TypeScript); the event table equals the adapter's handled cases; the commission example equals the engine's arithmetic.
- **`InlineCode`** for identifiers in prose; **`Callout`** (info, success, warning, danger) used eight times across the guide — the security warning for identify is the one `danger`.

## 5. Mobile

- Docs bar with menu button; the sidebar opens as a modal drawer (focus moves in, Tab is contained, Escape closes, focus returns to the button; the page does not scroll behind it) with language, theme and Painel at the bottom.
- Outline hidden; headings keep their anchors.
- Code blocks scroll horizontally inside their frame; the copy button stays in the header.
- Tables (fields, events, errors) scroll horizontally inside their frame.
- The five-step flow stacks vertically; code spans inside those narrow cards may wrap at spaces.
- Checked at 390 and 430 (light and dark), 768 and 1024: no page-level horizontal overflow.

## 6. Dark / light

- Page on `background`; code on `surface-2` with a hairline — distinct from the canvas in both themes, never pure black.
- Sidebar/outline active state: foreground text and a 1 px foreground marker on the rail; no coloured fill.
- Callouts: hairline box with a 2 px tone edge and icon; body text stays neutral.
- "Você" badge in the flow uses the amber identity mark; no amber buttons in content (the only amber action is "Criar conta" in the bar).

## 7. Accessibility

- One H1, semantic H2/H3 in order; breadcrumb `nav`; sidebar and outline are labelled `nav`s with `aria-current="location"`.
- Anchor links named "Copiar link para “…”"; copy confirmation in a live region.
- Copy buttons have text labels; `<pre>` is keyboard-focusable for scrolling.
- Callouts are `aside role="note"` named by their title.
- Tables have `th scope="col"` and an accessible name.

## 8. Verification

- Opened at 1440 (dark, full scroll), 390 (light and dark), 430, 768, 1024; drawer opened and closed; anchor links land below the sticky bar; scroll-spy follows in sidebar and outline.
- Copy: the button is hydrated and wired to the code element, but the embedded test browser denies clipboard access, so the "Copiado" state could not be observed there. The same `CopyButton` is used in the affiliate portal.
- Technical divergences: see `DOCS_TECHNICAL_FINDINGS.md` — **T1 (Stripe webhook routing) blocks a real founder from completing step 3** outside a single-workspace setup.

## 9. Not done

- **Search**: no infrastructure exists; not faked.
- **MDX**: not introduced. One page of content, already split into catalogue prose and tested code samples; MDX would add a compiler and a second authoring path without a present need. Revisit when the guide becomes several pages.
- **Previous/next pagination**: nothing to paginate yet.
