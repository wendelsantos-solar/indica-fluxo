# SEO_AUDIT.md

Auditoria técnica de SEO do site público — estado encontrado, o que foi
corrigido e o que ficou pendente.

Data: 2026-09-18 · Base: working tree · Next.js 16.3.5, next-intl 4.14.
Evidência: leitura do código, `pnpm seo:check` contra build de produção
(`localhost:3100`, 358 verificações), `pnpm perf:vitals` (Chrome headless,
mobile 412×915, CPU 4×, rede ~4G lenta), testes em `src/lib/seo/__tests__/`.

Formato de cada item: **CURRENT** (o que existia) · **PROBLEM** · **IMPACT** ·
**RECOMMENDATION** · **IMPLEMENTATION** (o que foi feito, com arquivo).

---

## Resumo

| # | Área | Severidade | Status |
| --- | --- | --- | --- |
| A1 | Marca espalhada no código | alta (rebrand) | resolvido |
| A2 | Domínio / origem pública | alta | resolvido |
| A3 | Sem robots.txt | alta | resolvido |
| A4 | Sem sitemap | alta | resolvido |
| A5 | Páginas privadas sem `noindex` | alta | resolvido |
| A6 | Hreflang duplicado/inconsistente | média | resolvido |
| A7 | Canonical ausente na home, OG faltando | média | resolvido |
| A8 | Sem dados estruturados | média | resolvido |
| A9 | Posicionamento da landing (H1 genérico) | alta (P1) | resolvido |
| A10 | Nenhuma página por intenção de busca | alta (P1) | resolvido (3 PT + 3 EN) |
| A11 | Links internos | média | resolvido |
| A12 | Medição SEO → ativação | alta | resolvido (server-side) |
| A13 | Descrições longas demais | baixa | resolvido |
| A14 | Páginas legais inexistentes | média | **pendente** |
| A15 | Preços só em BRL para o público EN | média (comercial) | **pendente** (decisão de negócio) |
| A16 | URL interna em outro idioma cai no login | baixa | aceito |
| A17 | Logo em PNG para o Google | baixa | pendente |

---

## A1. Marca espalhada

- **CURRENT:** "IndicaFluxo" escrito em 24 mensagens por catálogo, no `Logo`,
  no `applicationName`, no `siteName` do OG, no card social e no snippet de
  código da documentação (`INDICAFLUXO_SECRET_KEY`).
- **PROBLEM:** o nome pode virar "Refvia". Um rebrand exigiria caçar strings.
- **IMPACT:** rebrand arriscado; nome antigo sobrando em title/OG.
- **RECOMMENDATION:** uma fonte só.
- **IMPLEMENTATION:** `src/lib/brand.ts` (`BRAND.name`, `supportEmail`,
  `social.*` — todos `null` até existirem de verdade). Catálogos usam `{brand}`,
  substituído em `src/i18n/request.ts` (`withBrand`) antes da formatação.
  Teste falha se o nome aparecer literal num catálogo. Identificadores de
  integração (`ifx_`, `indicafluxo_ref`, cookies do tracker) **não** mudam num
  rebrand — estão em sistemas de clientes; documentado em `brand.ts`.

## A2. Domínio / origem pública

- **CURRENT:** `siteUrl()` lia `NEXT_PUBLIC_APP_URL`
  (`fazproposta.wendelpaco.dev`) e servia tanto para canonical quanto para
  OAuth/snippets.
- **PROBLEM:** site público e app podem ter domínios diferentes; o host atual é
  temporário.
- **IMPACT:** canonical apontando para host provisório; trocar domínio mexeria
  em OAuth.
- **RECOMMENDATION:** separar origem do app e origem do site.
- **IMPLEMENTATION:** `src/lib/site.ts`: `appUrl()` (API, tracker, OAuth,
  snippets) e `siteUrl()` (`NEXT_PUBLIC_SITE_URL`, cai no app se vazio).
  `.env.example` documentado; `.env.example` deixou de trazer o host pessoal.

## A3. robots.txt

- **CURRENT:** inexistente (404).
- **PROBLEM:** nenhuma orientação de rastreamento; nenhum sitemap anunciado.
- **IMPACT:** crawl budget gasto em `/api`, portal, dashboard.
- **RECOMMENDATION:** robots com allow do site, disallow de superfícies de
  máquina, e desligável por ambiente.
- **IMPLEMENTATION:** `src/app/robots.ts`. Com `SITE_INDEXING=on`: `Allow: /`,
  `Disallow: /api/`, `/t.js`, `/pt-br/app`, `/en/app`, `/pt-br/afiliado/`,
  `/en/affiliate/` (derivados de `routing.ts`), `Sitemap:` absoluto. Sem a flag:
  `Disallow: /`. robots **não** é a barreira de privacidade — ver A5.

## A4. Sitemap

- **CURRENT:** inexistente.
- **IMPLEMENTATION:** `src/app/sitemap.ts`, gerado **só** do registro
  `src/lib/seo/pages.ts`: 6 páginas × 2 idiomas = 12 URLs, cada uma com
  alternates `pt-BR`/`en`/`x-default` e `lastModified` = data real do
  conteúdo (mantida à mão no registro, nunca a data do build). Sem `priority`
  nem `changefreq` (o Google ignora; inventar não informa nada). Vazio com a
  indexação desligada.

## A5. noindex nas páginas privadas

- **CURRENT:** nenhuma página declarava `robots`. Login, cadastro, esqueci a
  senha e redefinir senha eram 200 indexáveis. Dashboard/portal/onboarding
  redirecionam para login (proxy), então não vazavam — mas a página de destino
  era indexável.
- **IMPACT:** "Entrar | IndicaFluxo" competindo com a home no SERP da marca.
- **RECOMMENDATION:** privado por padrão, indexável por registro.
- **IMPLEMENTATION:** o layout raiz (`src/app/[locale]/layout.tsx`) declara
  `robots: { index: false, follow: false }`; só páginas registradas
  sobrescrevem via `pageMetadata()`. `X-Robots-Tag: noindex` em `/api/*` e
  `/t.js` (`next.config.ts`). Validado: 6 páginas de auth com `noindex`;
  dashboard, portal, `/app`, onboarding e caminhos inexistentes → 307 para
  login (`noindex`).

## A6. Hreflang

- **CURRENT:** a home e preços/docs declaravam `pt-BR`, `en-US`, `x-default`
  (→ pt-br) no HTML; ao mesmo tempo o middleware do next-intl emitia um header
  `Link` com alternates para **todas** as rotas (inclusive privadas), com
  códigos e `x-default` próprios.
- **PROBLEM:** dois conjuntos de hreflang divergentes; alternates para páginas
  privadas.
- **IMPLEMENTATION:** `alternateLinks: false` em `routing.ts`; hreflang só no
  HTML de páginas registradas, via `pageAlternates()`: `pt-BR`, `en` e
  `x-default` → versão EN (o leitor que não é nem lusófono nem anglófono é
  melhor servido em inglês). Recíproco: as duas versões declaram o mesmo
  conjunto (testado). Pares das páginas SEO têm slugs escritos por mercado,
  não traduzidos.

## A7. Canonical e Open Graph

- **CURRENT:** preços e docs tinham canonical; a home também, mas montado à
  parte. `og:image` só existia na home — preços e docs declaravam `openGraph`
  próprio, que **substitui** o do segmento pai (imagem incluída), ficando sem
  imagem. Twitter card só na home.
- **IMPLEMENTATION:** `pageMetadata()` (`src/lib/seo/metadata.ts`) gera para
  toda página indexável: title (template `%s | {brand}`), description,
  canonical absoluto e autorreferente sem query, alternates, robots,
  `og:title/description/url/type/locale/alternateLocale/siteName`,
  `twitter:card=summary_large_image` (sem `twitter:site` enquanto não houver
  handle). Card social 1200×630 próprio por página
  (`src/components/seo/social-card.tsx` + `opengraph-image.tsx` em home,
  preços, docs e nas 3 páginas SEO). Validado: UTM na URL não entra no
  canonical.

## A8. Dados estruturados

- **CURRENT:** nenhum.
- **IMPLEMENTATION:** `src/lib/seo/structured-data.ts`.
  Home: `Organization`, `WebSite`, `SoftwareApplication` com `offers` = planos
  públicos de `PLAN_OFFERS` (R$ 0, 99, 197 — os mesmos da página de preços).
  Preços, docs e páginas SEO: `BreadcrumbList`, espelhando a trilha visível.
  **Não** emitidos: `AggregateRating`/`Review` (não há avaliações reais) e
  `FAQPage` (o Google restringiu rich results de FAQ a sites de governo/saúde
  em 2023; as FAQs continuam visíveis no HTML). Teste garante ausência de
  rating e que os preços batem com `PLAN_OFFERS`. `<` escapado no JSON-LD.

## A9. Posicionamento da landing

- **CURRENT:** H1 PT "Transforme indicações em um canal de crescimento." /
  EN "Turn referrals into a predictable growth channel." — nenhuma palavra da
  categoria. Title "IndicaFluxo — programa de afiliados para SaaS" ok.
- **IMPACT:** a página mais forte do domínio não diz, no H1, o que vende.
- **IMPLEMENTATION:** H1 PT "Programa de afiliados para o seu SaaS"; EN
  "Affiliate software built for SaaS". Subtítulo específico (qual afiliado
  trouxe cada cliente, comissão recorrente do Stripe, reversão de estorno, sem
  percentual). Título: "{brand} — Programa de afiliados para SaaS" /
  "{brand} — Affiliate Software for SaaS". Marca fica na navbar, não no H1.
  FAQ comercial visível adicionada antes do CTA final (6 perguntas, respostas
  conferidas no código).

## A10. Páginas por intenção

- **CURRENT:** só home, preços e docs.
- **IMPLEMENTATION:** 3 pares PT/EN (ver SEO_CONTENT_MAP.md), um Server
  Component (`src/features/marketing/content-page.tsx`), sem JS de cliente,
  1 H1, H2 por seção, H3 em pontos/passos/perguntas, `article` + `aside` +
  `nav` de breadcrumb e de "continue lendo". Toda afirmação conferida contra o
  código (métodos de checkout do `INTEGRATION_REWORK_REPORT.md` §7, janela
  1–365 dias, carência 0–180, reversão sem clawback automático, BRL, limites
  por programas/afiliados/membros). Páginas de comparação **não** publicadas;
  o registro exige `verifiedOn` ≤ 120 dias para intenção `comparison`
  (teste).

## A11. Links internos

- **CURRENT:** footer com âncoras da home, preços, docs; nenhuma rota de
  conteúdo.
- **IMPLEMENTATION:** landing → guia SaaS (bloco "problema") e → página Stripe
  (bloco integrações) e → preços (FAQ). Páginas SEO se ligam por links no texto
  (`<stripe>`, `<pricing>`, `<docs>`) e por um bloco "Continue lendo" de 3
  cartões. Footer: Produto · Recursos (docs + 3 páginas) · Conta — 10 links,
  sem "link farm".

## A12. Medição SEO → ativação

- **CURRENT:** nenhuma camada de analytics de produto (confirmado também em
  `INTEGRATION_REWORK_REPORT.md` §18.6).
- **PROBLEM:** impossível saber se tráfego orgânico vira workspace, programa,
  comissão, assinatura.
- **IMPLEMENTATION:** first touch capturado no proxy (sem script de cliente):
  canal (orgânico, pago, social, e-mail, referral, campanha, direto), landing,
  locale, host de referência, UTM — cookie `_acq` first-party, HttpOnly, 90
  dias, só em carregamento de documento. Gravado em `workspaces.acquisition`
  (migration 0017) na criação do workspace. `pnpm seo:funnel` cruza com marcos
  que o banco já registra. Detalhes em SEO_STRATEGY.md §7.

## A13. Descrições

- **CURRENT/PROBLEM:** 8 descrições entre 164 e 199 caracteres (cortadas no
  SERP).
- **IMPLEMENTATION:** todas ≤ 160; `seo:check` falha acima disso.

## A14. Páginas legais — pendente

- **CURRENT:** não existem (o footer, corretamente, não as linka).
- **IMPACT:** confiança (B2B pede Termos/Privacidade antes de cadastrar),
  LGPD (política de privacidade é obrigatória com cadastro e cookie `_acq`),
  e sinais de qualidade.
- **RECOMMENDATION:** Termos de uso e Política de privacidade, redigidos ou
  revisados por advogado. Não gerado aqui — texto jurídico inventado é pior
  que nenhum. Quando existirem: registrar em `pages.ts` e linkar no footer.

## A15. Público EN vê preços em BRL — pendente

- Os planos são cobrados em BRL em todos os idiomas (`docs/PLANS.md` §1). A
  página EN declara isso ("billed in Brazilian reais"). É honesto, mas é uma
  fricção comercial real para o ICP internacional; decisão de pricing, fora do
  escopo de SEO.

## A16. Caminho interno em outro idioma

- `/en/saas-affiliate-program` (nome interno da rota) não redireciona para
  `/en/affiliate-software-for-saas`: o proxy não reconhece a grafia e manda
  para o login (`noindex`). Não é linkado em lugar nenhum; aceito.

## A17. Logo

- `Organization.logo` aponta para `/icon.svg` (criado). O Google aceita SVG,
  mas recomenda bitmap ≥ 112px; quando a marca final existir, trocar por PNG.

---

## Headings e HTML semântico

- Marketing: `header` (navbar) · `nav` · `main` · `footer` já existiam.
- Landing: 1 H1; seções com H2; itens com H3. Os títulos dos "princípios"
  e "integrações" são `p` estilizado (listas curtas, não seções) — aceitável.
- Preços: 1 H1; cartões de plano com H2.
- Docs: `main` > `article`, breadcrumb `nav`, H1 único, H2/H3 ancorados
  (DOCS_UI_AUDIT). Sem mudança estrutural.
- Páginas SEO: `article` > `section[aria-labelledby]` > H2; `aside` com
  sumário; tabela com `caption`, `th[scope]`, região rolável focável.
- Validado pelo `seo:check`: exatamente 1 `<h1>` em todas as 12 URLs.

## Core Web Vitals (laboratório)

Build de produção, `pnpm perf:vitals <url> 3` (mediana de 3, mobile, CPU 4×,
~4G lenta, cache frio):

| Página | TTFB | FCP = LCP | CLS | Transfer |
| --- | --- | --- | --- | --- |
| `/pt-br` | 9 ms | 928 ms | 0.0008 | 402 KB |
| `/en/pricing` | 6 ms | 936 ms | 0.0268 | 383 KB |
| `/pt-br/programa-de-afiliados-saas` | 10 ms | 940 ms | 0.0119 | 399 KB |
| `/pt-br/software-de-afiliados-saas` | 7 ms | 940 ms | 0.0124 | 397 KB |
| `/en/stripe-affiliate-software` | 6 ms | 952 ms | 0.0124 | 433 KB |

Tudo dentro de "bom" (LCP < 2.5 s, CLS < 0.1). Páginas estáticas (SSG), LCP é
texto (H1), fontes self-hosted com `display: swap` e preload só `latin`, sem
imagens no hero, sem JS de cliente nas páginas SEO além do header. INP não
medido (sem script de interação — mesma limitação do PERFORMANCE_AUDIT.md);
TTFB real depende do host/CDN do deploy. Dados de campo: Search Console → Core
Web Vitals, após tráfego.

## Mobile, acessibilidade, tema

- 375, 390, 430 e 768 px: sem overflow horizontal em home, preços, docs e nas
  6 páginas SEO (medido: `scrollWidth − clientWidth = 0`); a
  tabela de comparação rola dentro de uma região própria com `tabindex=0` e
  `aria-label`.
- Claro e escuro verificados visualmente; só tokens semânticos, sem cor
  literal (exceto o card OG, exceção já prevista no DESIGN.md).
- Landmarks, breadcrumb com `aria-current`, `aria-hidden` nos ícones.
