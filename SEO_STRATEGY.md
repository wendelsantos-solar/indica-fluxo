# SEO_STRATEGY.md

Como o site deve ganhar tráfego orgânico — e de quem. Complementa
SEO_AUDIT.md (técnico), SEO_CONTENT_MAP.md (URL por URL) e
SEO_DEPLOY_CHECKLIST.md (colocar no ar).

Data: 2026-09-18.

---

## 1. Objetivo

Construir uma associação, não visitas:

- Brasil: **{brand} → programa de afiliados para SaaS**
- Global: **{brand} → affiliate software for SaaS**
- Ambos: → Stripe → comissão recorrente.

O visitante certo é o founder/operador de um SaaS B2B, cobrando pelo Stripe,
que quer **criar** ou **trocar** a infraestrutura de afiliados. 100 visitas
desse perfil valem mais que 10.000 de quem quer "virar afiliado".

## 2. Quem não é o público

Não otimizar, não linkar, não escrever para: "como ser afiliado", afiliado
Shopee/Shein/Temu/Amazon, "ganhar dinheiro como afiliado", marketing de
afiliados para criador, curso de afiliados.

Por isso:
- O termo genérico "programa de afiliados" (volume alto, SERP dominado por
  B2C, Google Trends) **não** é alvo. Sempre qualificado: "para SaaS",
  "Stripe", "software", "sistema", "gestão".
- O guia PT desambigua em texto ("não é o modelo de marketplace") sem citar
  marketplaces por nome — citar atrairia exatamente essa intenção. Um teste
  (`seo.test.ts`) falha se o namespace `seo` mencionar Shopee, Shein, Temu,
  Amazon, "ganhar dinheiro", "curso de afiliado", "make money".

## 3. Palavras-chave e intenção

| Mercado | Prioridade | Termos | Página |
| --- | --- | --- | --- |
| BR | P1 | programa de afiliados para SaaS | home + guia |
| BR | P1 | software / sistema / plataforma de afiliados para SaaS | software-de-afiliados-saas |
| BR | P1 | afiliados Stripe | afiliados-stripe |
| BR | P2 | rastreamento de afiliados, comissão recorrente afiliados, gestão de afiliados SaaS | seções do guia; páginas próprias no backlog |
| Global | P1 | affiliate software for SaaS, SaaS affiliate software | home + affiliate-software-for-saas |
| Global | P1 | affiliate management software | affiliate-management-software |
| Global | P1 | Stripe affiliate software | stripe-affiliate-software |
| Global | P2 | affiliate tracking software, recurring affiliate commissions | seções; backlog |
| Global | P3 | Rewardful / Tolt / FirstPromoter alternative | backlog (comparação verificada) |

Sinal de mercado: no Google Trends, "Rewardful" aparece em alta entre as
pesquisas relacionadas a "affiliate software" — oportunidade de fundo de
funil **depois** de haver comparação factual (§5).

## 4. Princípios de conteúdo

1. **Uma intenção por página.** Intenção → página específica → resposta útil →
   produto onde cabe → CTA. Nada de páginas-porta trocando uma palavra.
2. **Priorizar COMMERCIAL e TRANSACTIONAL.** Artigo puramente informativo só
   depois de clientes, e só se levar ao produto.
3. **Específico em vez de slogan.** "Saiba qual afiliado trouxe cada cliente",
   "reverta a comissão quando houver estorno" — nunca "revolucione seu
   marketing".
4. **Só afirmações verdadeiras no código.** Métodos de checkout, janelas,
   carência, reversão, preços e limites foram conferidos em `src/` e em
   `docs/PLANS.md`. Onde o produto tem limite, a página diz:
   - reembolso de comissão **já paga** não é descontado automaticamente;
   - hoje só Stripe gera comissão ("se você cobra por outro meio, ainda não
     somos a ferramenta certa");
   - preços em BRL, inclusive para o público EN.
5. **Sem**: backlinks comprados, artigos em massa por IA, texto oculto,
   avaliações/depoimentos/contagem de clientes inventados, integrações que não
   existem, `AggregateRating`.
6. **Marca ≠ SEO.** A marca fica na navbar e no fim do title
   (`%s | {brand}`); a categoria vai no H1, subtítulo e copy. A home é a
   exceção: "{brand} — Programa de afiliados para SaaS", para construir marca +
   categoria desde a primeira impressão.
7. **Qualidade > quantidade.** 3 páginas por idioma agora. Nada de SEO
   programático em escala sem autoridade e sem dados próprios.

## 5. Páginas de comparação (arquitetura pronta, nada publicado)

Formato previsto: `/en/rewardful-alternative`, `/en/tolt-alternative`,
`/en/firstpromoter-alternative`, `/pt-br/alternativa-rewardful`.

Regras antes de publicar:
- verificar no site do concorrente: preço, taxa sobre receita, limites,
  integrações, data da verificação;
- registrar a página em `pages.ts` com `intent: "comparison"` e `verifiedOn`
  — o teste falha quando a verificação passa de 120 dias;
- mostrar a data da comparação na página;
- comparar só o que dá para provar; onde o concorrente é melhor, dizer.

A infraestrutura é a mesma das páginas atuais: `content-pages.ts` já tem bloco
`table` (colunas × linhas) para a comparação.

## 6. Clusters e backlog editorial

| Cluster | No ar | Próximo |
| --- | --- | --- |
| Affiliate program | guia SaaS (PT/EN), software (PT/EN) | — |
| Attribution | seção do guia | first-click vs last-click; janela de atribuição |
| Commission | seções do guia | comissão recorrente; cálculo de comissão; estorno de comissão |
| Stripe | afiliados-stripe (PT/EN) | rastrear afiliados no Stripe (passo a passo, liga à docs) |
| Alternatives | — | Rewardful, Tolt, FirstPromoter (§5) |

Primeiros artigos (quando houver clientes; não escritos agora):

- PT: Como criar um programa de afiliados para SaaS · Como calcular comissão
  recorrente de afiliado · First-click vs last-click · Como rastrear afiliados
  no Stripe · Como tratar estorno de comissão.
- EN: How to create an affiliate program for SaaS · SaaS affiliate commission
  structures · First-click vs last-click attribution · Stripe affiliate
  tracking · How affiliate commissions work on refunds.

**Blog/CMS:** não há suporte a MDX/Markdown hoje, e não foi adicionado CMS
externo (fase de teste). Os guias usam o mesmo mecanismo das páginas atuais
(catálogo + mapa de seções). Se o volume de artigos justificar, adicionar MDX
local — não um CMS.

## 7. Medir SEO → ativação, não pageviews

Funil desejado: Organic Search → SEO landing → Signup → Sandbox conversion →
Tracker installed → First commission → Paid.

Como é medido (sem script de analytics no cliente):

| Etapa | Fonte |
| --- | --- |
| Origem, landing, locale, UTM | proxy grava first touch no cookie `_acq` (`src/lib/seo/acquisition.ts`) na primeira página pública |
| Signup + workspace | `createWorkspaceAction` copia o `_acq` para `workspaces.acquisition` e apaga o cookie |
| Programa criado | existe `programs` do workspace |
| Conversão no Sandbox | existe comissão em programa `test` |
| Tracker instalado | existe clique real (visitantes simulados `v_sim…` excluídos) |
| Primeira comissão | existe comissão em programa `live` |
| Pago | `workspace_subscriptions` em plano pago, `active`/`trialing`/`past_due` |

`pnpm seo:funnel` imprime a tabela por canal × landing (somente contagens).

Classificação de canal: `gclid`/`msclkid` ou `utm_medium` pago → paid;
`utm_medium` email/social → email/social; `utm_medium=organic` → organic;
outro UTM → campaign; sem UTM, referrer de buscador (Google, Bing,
DuckDuckGo, Yahoo, Yandex, Ecosia, Baidu, Brave, Qwant) → organic_search;
rede social → social; outro site → referral; nada → direct.

UTM: preservado — o redirect `/ → /pt-br|/en` mantém a query (verificado), o
proxy lê os parâmetros antes de qualquer coisa, e o canonical nunca os inclui.

Limitações honestas:
- signup sem criar workspace não é contado (o marco começa no workspace);
- quem limpa cookies ou volta após 90 dias chega como `unknown`/`direct`;
- workspaces anteriores à migration 0017 ficam `unknown`;
- pageviews/SERP (impressões, CTR, posição) vêm do Search Console, não daqui.

## 8. Regras para quem escrever a próxima página

1. Nome da marca: nunca literal — `{brand}` no catálogo, `BRAND.name` no código.
2. Registrar em `src/lib/seo/pages.ts` (intenção, cluster, `updated`).
3. Slug por mercado em `routing.ts` (não traduzir literalmente).
4. Mapa de seções em `content-pages.ts`; copy nos dois catálogos (o teste de
   paridade e o de chaves do layout pegam faltas).
5. `page.tsx` + `opengraph-image.tsx`.
6. Linha no SEO_CONTENT_MAP.md.
7. Toda afirmação sobre o produto conferida no código; toda afirmação sobre
   concorrente, datada.
8. `pnpm test && SITE_INDEXING=on NEXT_PUBLIC_SITE_URL=http://localhost:3100 pnpm build && pnpm start -p 3100` e `pnpm seo:check`.
