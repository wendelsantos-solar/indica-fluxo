# SEO_CONTENT_MAP.md

Uma linha por URL indexável. Fonte técnica: `src/lib/seo/pages.ts` (registro),
`src/i18n/routing.ts` (slugs), `src/i18n/messages/*.json` (`meta`, `pricing`,
`docs`, `seo.pages.*`). Ao mudar título/descrição aqui, mude no catálogo — o
catálogo é o que vai ao ar. `{brand}` = `BRAND.name` (hoje Refvia).

Intenção: **INF** informacional · **COM** comercial · **TRA** transacional ·
**CMP** comparação. Status: **live** (no ar, indexável com `SITE_INDEXING=on`) ·
**backlog** · **blocked** (depende de algo fora do SEO).

---

## Páginas no ar

| URL | Locale | Primary keyword | Secondary keywords | Intent | Title | Meta description | H1 | CTA | Internal links | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/pt-br` | pt-BR | programa de afiliados para SaaS | software de afiliados para SaaS, sistema de afiliados para SaaS, rastreamento de afiliados | COM | {brand} — Programa de afiliados para SaaS | Crie e gerencie o programa de afiliados do seu SaaS: rastreamento, atribuição, comissões recorrentes e integração com Stripe. Sem percentual da sua receita. | Programa de afiliados para o seu SaaS | Começar grátis | → programa-de-afiliados-saas, afiliados-stripe, precos, documentacao | live |
| `/en` | en | affiliate software for SaaS | SaaS affiliate software, affiliate tracking software, recurring affiliate commissions | COM | {brand} — Affiliate Software for SaaS | Launch and manage your SaaS affiliate program with referral tracking, attribution, recurring commissions and Stripe integration. No cut of your revenue. | Affiliate software built for SaaS | Start free | → affiliate-software-for-saas, stripe-affiliate-software, pricing, docs | live |
| `/pt-br/precos` | pt-BR | preço software de afiliados | software de afiliados sem percentual | TRA | Preços do software de afiliados \| {brand} | Comece grátis no Sandbox… Launch por R$ 99/mês e Growth por R$ 197/mês… Sem taxa sobre a sua receita. | Preço de ferramenta, não de imposto. | Começar grátis / Assinar | → criar-conta | live |
| `/en/pricing` | en | affiliate software pricing | affiliate software no revenue share | TRA | Affiliate Software Pricing \| {brand} | Start free in Sandbox… Launch at R$ 99/month and Growth at R$ 197/month… No cut of your revenue. | Priced like a tool, not a tax. | Start free | → signup | live |
| `/pt-br/documentacao` | pt-BR | integração afiliados Stripe | rastreamento de afiliados, API de atribuição | INF | Guia de integração: tracker, atribuição e Stripe \| {brand} | Instale o tracker, leve a referência de atribuição ao checkout do Stripe e veja a primeira comissão. Checkout, Payment Links, checkout próprio e assinaturas. | Guia de integração | Criar conta | → precos, home | live |
| `/en/docs` | en | Stripe affiliate tracking | affiliate attribution API, affiliate tracker | INF | Integration Guide: Tracker, Attribution and Stripe \| {brand} | Install the tracker, carry the attribution reference into Stripe checkout and see your first commission. Checkout, Payment Links, custom and subscriptions. | Integration guide | Sign up | → pricing, home | live |
| `/pt-br/programa-de-afiliados-saas` | pt-BR | programa de afiliados para SaaS | como criar programa de afiliados, comissão recorrente afiliados, rastreamento de afiliados, gestão de afiliados SaaS | COM | Programa de afiliados para SaaS: como criar o seu \| {brand} | Como montar o programa de afiliados do seu SaaS: rastreamento, atribuição, comissão recorrente, estornos e Stripe — sem percentual sobre a receita. | Programa de afiliados para SaaS | Criar programa grátis · Ver como funciona com Stripe | → afiliados-stripe (texto + card), software-de-afiliados-saas, precos | live |
| `/en/affiliate-software-for-saas` | en | affiliate software for SaaS | SaaS affiliate software, affiliate tracking software, SaaS referral software | COM | Affiliate Software for SaaS Companies \| {brand} | SaaS affiliate software that tracks referrals, attributes customers, pays recurring commissions from Stripe and reverses refunds. No cut of your revenue. | Affiliate software for SaaS | Start your program free · See how it works with Stripe | → stripe-affiliate-software, affiliate-management-software, pricing | live |
| `/pt-br/software-de-afiliados-saas` | pt-BR | software de afiliados para SaaS | sistema de afiliados para SaaS, plataforma de afiliados para SaaS, planilha de afiliados | COM | Software e sistema de afiliados para SaaS \| {brand} | Planilha, sistema próprio ou software de afiliados para SaaS? Compare rastreamento, comissão recorrente, estornos e portal — com preço fixo. | Software de afiliados para SaaS | Começar grátis · Ver preços | → programa-de-afiliados-saas, afiliados-stripe, precos | live |
| `/en/affiliate-management-software` | en | affiliate management software | affiliate management software for SaaS, best affiliate software, in-house affiliate system | COM | Affiliate Management Software for SaaS \| {brand} | Spreadsheet, in-house build or affiliate management software? Compare tracking, recurring commissions, refunds and the affiliate portal. Fixed price. | Affiliate management software for SaaS | Start free · See pricing | → affiliate-software-for-saas, stripe-affiliate-software, pricing | live |
| `/pt-br/afiliados-stripe` | pt-BR | afiliados Stripe | programa de afiliados Stripe, rastreamento de afiliados Stripe, comissão recorrente Stripe | COM | Programa de afiliados para Stripe \| {brand} | Afiliados em pagamentos do Stripe: Checkout, Payment Links, checkout próprio e assinaturas. Comissão recorrente, reversão em reembolso, sem chave secreta. | Programa de afiliados para SaaS que usa Stripe | Criar programa grátis · Ler a documentação | → documentacao (texto + card), programa-de-afiliados-saas, software-de-afiliados-saas | live |
| `/en/stripe-affiliate-software` | en | Stripe affiliate software | Stripe referral tracking, Stripe affiliate program, Stripe recurring affiliate commission | COM | Stripe Affiliate Software for SaaS \| {brand} | Track affiliates on Stripe payments: Checkout, Payment Links, custom checkouts and subscriptions. Recurring commissions, refund reversals, no secret key. | Affiliate software for SaaS on Stripe | Start your program free · Read the docs | → docs, affiliate-software-for-saas, affiliate-management-software | live |

### Pares hreflang

| Intenção | pt-BR | en |
| --- | --- | --- |
| Marca + categoria | `/pt-br` | `/en` |
| Preço | `/pt-br/precos` | `/en/pricing` |
| Integração | `/pt-br/documentacao` | `/en/docs` |
| Criar/entender um programa (guia) | `/pt-br/programa-de-afiliados-saas` | `/en/affiliate-software-for-saas` |
| Escolher uma ferramenta | `/pt-br/software-de-afiliados-saas` | `/en/affiliate-management-software` |
| Stripe | `/pt-br/afiliados-stripe` | `/en/stripe-affiliate-software` |

`x-default` → versão EN em todos os pares.

**Canibalização a vigiar:** a home e o guia miram o mesmo termo-cabeça
("programa de afiliados para SaaS" / "affiliate software for SaaS"). A home
responde marca + categoria (navegacional/comercial); o guia, a pergunta
completa. Se o Search Console mostrar as duas alternando na mesma query por
semanas, diferenciar o title do guia para a variante "como criar" / "how to".

---

## Backlog (não publicado)

Ordem = prioridade. Só entra no ar com conteúdo útil **e** afirmações
conferidas no código.

| URL proposta | Locale | Primary keyword | Intent | Cluster | Depende de | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `/en/rewardful-alternative` | en | Rewardful alternative | CMP | alternatives | verificação factual (preço, limites, taxas, data) + `verifiedOn` | backlog |
| `/pt-br/alternativa-rewardful` | pt-BR | alternativa Rewardful | CMP | alternatives | idem | backlog |
| `/en/firstpromoter-alternative` | en | FirstPromoter alternative | CMP | alternatives | idem | backlog |
| `/en/tolt-alternative` | en | Tolt alternative | CMP | alternatives | idem | backlog |
| `/pt-br/comissao-recorrente-afiliados` | pt-BR | comissão recorrente afiliados | COM/INF | commission | — | backlog |
| `/en/recurring-affiliate-commissions` | en | recurring affiliate commissions | COM/INF | commission | — | backlog |
| `/pt-br/…/atribuicao-primeiro-ultimo-clique` | pt-BR | first-click vs last-click | INF | attribution | infraestrutura de guias (ver STRATEGY §6) | backlog |
| `/en/…/first-click-vs-last-click` | en | first-click vs last-click attribution | INF | attribution | idem | backlog |
| `/pt-br/…/estorno-comissao-afiliado` | pt-BR | estorno comissão afiliado | INF | commission | idem | backlog |
| `/en/…/affiliate-commission-refunds` | en | affiliate commissions on refunds | INF | commission | idem | backlog |
| `/pt-br/termos`, `/pt-br/privacidade` (+ EN) | ambos | — | — | legal | texto jurídico revisado | blocked |
| `/pt-br/afiliados-mercado-pago` | pt-BR | afiliados Mercado Pago | COM | provider | **requires PRODUCTION_READY connector** (PROVIDER_PRODUCTION_VALIDATION.md) | blocked |
| `/pt-br/afiliados-asaas` | pt-BR | afiliados Asaas | COM | provider | **requires PRODUCTION_READY connector** | blocked |
| `/pt-br/afiliados-abacatepay` | pt-BR | afiliados AbacatePay | COM | provider | **requires PRODUCTION_READY connector** | blocked |

Artigos futuros listados em SEO_STRATEGY.md §6.

**Meios de pagamento em beta** (Mercado Pago, AbacatePay, Asaas): documentados
em `/docs/beta` (noindex, fora de `src/lib/seo/pages.ts`) e dentro do produto.
Nenhuma página indexável os cita como funcionalidade; a landing diz só que o
Stripe é o meio estável e que outros "estão em validação", sem nomes. Uma página
de provider só sai do bloqueio quando o provider for IMPLEMENTED +
REAL_ACCOUNT_TESTED + WEBHOOK_TESTED + REFUND_TESTED + CUSTOMER_MATCHING_TESTED
+ DOCUMENTED + PRODUCTION_READY.
