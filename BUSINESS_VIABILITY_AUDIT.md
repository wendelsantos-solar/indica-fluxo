# BUSINESS_VIABILITY_AUDIT.md

Auditoria comercial do IndicaFluxo — não da qualidade técnica, da vendabilidade.

Data: 2026-09-17 · Base: working tree (inclui alterações não commitadas) ·
Evidência: código, testes (`pnpm test`: 465 passando, 92 puladas — as de banco),
app rodando em `localhost:3000`, auditorias internas do próprio repositório
(`PLAN_FEATURE_AUDIT.md`, `LANDING_CLAIMS_AUDIT.md`, `DOCS_IMPLEMENTATION_AUDIT.md`),
e pesquisa de mercado feita nesta sessão (fontes no fim).

Fato de contexto que muda a leitura de tudo: **o primeiro commit é de 2026-09-14.**
O projeto tem 4 dias, 27 commits, 51.111 linhas em `src/`. `indicafluxo.com` e
`indicafluxo.com.br` estão **livres**. `NEXT_PUBLIC_APP_URL` aponta para
`fazproposta.wendelpaco.dev`. Não existe deploy, domínio, tráfego, usuário,
lista de espera ou conversa com cliente. Toda a análise abaixo é sobre um
produto tecnicamente adiantado e comercialmente em marco zero.

---

# Executive Summary

**O problema existe e é real, mas é um problema de segunda ordem, raro e tardio.**
Ele só aparece depois que um founder decide fazer marketing de afiliados — uma
minoria dos SaaS — e só dói de verdade depois do 5º ou 10º afiliado. Isso não
inviabiliza o negócio; define que a aquisição é o gargalo, não o produto.

**O produto é real.** Não é maquete. Motor de comissão (percentual, fixo,
recorrente, retenção), atribuição first/last-click com janela, idempotência de
webhook por `(provider, provider_event_id)`, estornos e disputas como reversões
append-only, ambiente test/live separado, RLS com role de aplicação dedicada,
limites de plano à prova de concorrência com advisory lock, portal do afiliado,
lotes de pagamento com CSV, cobrança própria via Stripe Checkout. Isso é
infraestrutura financeira de verdade, com 465 testes verdes. Muito micro-SaaS
lançado e pago tem menos do que isso.

**O diferencial hoje é essencialmente zero.** O mercado tem no mínimo 8
concorrentes diretos, vários mais baratos, todos com integração Stripe mais
fácil (OAuth de um clique) e nenhum exigindo chamada de backend obrigatória. O
IndicaFluxo exige: instalar script + **chamar `/api/identify` do backend** +
criar endpoint de webhook no Stripe manualmente + selecionar 10 eventos + colar
o signing secret. Isso é mais fricção que **todos** os concorrentes pesquisados.

**Existe uma contradição estratégica central no posicionamento.** O produto é
Stripe-only, com preço em BRL (R$ 99 / R$ 197), com landing em pt-br e en. Mas:
(a) o SaaS brasileiro típico cobra por Asaas, Iugu, Vindi, Pagar.me ou Mercado
Pago — não por Stripe; (b) o comprador global que usa Stripe vê preço em reais
numa página em inglês e não entende; (c) R$ 99 ≈ US$ 18, ou seja, o produto está
precificado a ~1/3 do mercado global sem que isso esteja sendo usado como arma.
A interseção "usa Stripe **e** paga em BRL **e** quer produto em português" é
estreita — mas **não é vazia**, e é justamente onde está o único wedge honesto
disponível hoje.

**Podemos cobrar hoje?** `NOT YET` — por 4 motivos operacionais, não de valor:
não há deploy nem domínio; a cobrança da plataforma nunca rodou contra um Stripe
real (só payloads assinados e SDK mockado, conforme `PLAN_FEATURE_AUDIT.md` §B4);
existe um P1 conhecido em que uma integração *aparentemente correta* nunca gera
comissão nenhuma sem avisar ninguém (`DOCS_IMPLEMENTATION_AUDIT.md` P1-1); e
estorno depois de comissão paga não tem clawback. Num produto de dinheiro,
cada um desses é um pedido de reembolso.

**Recomendação: `VALIDATE_BEFORE_MORE_DEVELOPMENT`.** Parar de construir
funcionalidade. Gastar os próximos 30 dias em deploy + 40 conversas + 3
integrações completas + tentativa real de cobrança. O risco desse projeto não é
técnico, é construir mais 3 meses de excelência para um canal que o cliente não
prioriza.

---

# What IndicaFluxo Actually Is

## One-line value proposition

> **IndicaFluxo é a infraestrutura que transforma cliques de afiliados em
> comissões corretas — rastreamento, atribuição, comissão recorrente, estorno e
> conciliação — para SaaS que cobra pelo Stripe, sem tirar percentual da receita.**

Respondendo o que foi pedido:

- **Quem é o cliente?** O founder/CTO de um SaaS por assinatura que cobra pelo
  Stripe e decidiu ter um programa de afiliados. Não é o afiliado; o afiliado é
  usuário, não comprador.
- **Qual problema ele tem?** Ele consegue criar links e cupons sozinho. O que ele
  não consegue sem sofrer é: saber a quem creditar quando dois afiliados tocam o
  mesmo cliente, calcular comissão sobre renovação recorrente, não pagar duas
  vezes quando o Stripe manda `invoice.paid` e `payment_intent.succeeded` pelo
  mesmo pagamento, reverter comissão quando há estorno 40 dias depois, e fechar o
  mês sabendo quanto deve a quem.
- **Qual trabalho ele contrataria o IndicaFluxo para executar?** "Me diga, sem eu
  precisar confiar em planilha, quanto eu devo a cada afiliado neste mês — e me
  deixe pagar sem medo de estar errado."
- **Qual resultado ele espera?** Operacional, não financeiro: o programa de
  afiliados deixa de ser um passivo de conciliação. O ganho financeiro (receita
  via afiliados) é mérito do programa dele, não da ferramenta — e isso é uma
  fraqueza séria de proposta de valor, tratada em *Churn Risks*.
- **Por que não construir internamente?** Porque a parte visível (link + cookie)
  é 2 dias e a parte invisível (idempotência, reversão proporcional, atribuição
  em renovação, dupla comissão, test/live) é 2 meses — e, pior, é um sistema que
  erra silenciosamente e em dinheiro. O `DOCS_IMPLEMENTATION_AUDIT.md` deste
  próprio repositório é a melhor prova de venda que existe: 308 contratos
  auditados para acertar um fluxo que "parecia simples".

**Veredito de posicionamento:** a frase acima é respondível e honesta. Não há
problema de clareza. Há problema de *diferenciação* — a mesma frase serve para
Rewardful, Tolt, FirstPromoter e Affonso sem trocar uma palavra.

## Inventário do que existe de verdade

Classificação pedida: `IMPLEMENTED` · `PARTIALLY_IMPLEMENTED` · `DOCUMENTED_ONLY`
· `PLANNED`. Verificado no código, não na documentação.

### Núcleo do dinheiro

| Capacidade | Status | Evidência |
| --- | --- | --- |
| Script de rastreamento `/t.js` + `/api/track` | `IMPLEMENTED` | `src/app/t.js/route.ts`, `src/lib/tracking/script.ts`, testes de script e ingest |
| Cookie `_referral_id` 365d, `?ref=`/`?via=`/`?aff=`, subdomínio via `data-cookie-domain` | `IMPLEMENTED` | docs + `script.ts` |
| Atribuição first/last-click com janela por programa | `IMPLEMENTED` | `src/server/domain/attribution.ts` |
| Trava de renovação (renovação não muda de afiliado) | `IMPLEMENTED` | corrigido no pass B, testado |
| `POST /api/identify` (visitante → cliente) | `IMPLEMENTED` com um P1 conhecido | `src/server/services/identify.ts`; ver P1-1 abaixo |
| Webhook Stripe por workspace, segredo AES-256-GCM | `IMPLEMENTED` | `/api/webhooks/stripe/[integrationId]` |
| Idempotência de evento (`webhook_events`, UNIQUE) | `IMPLEMENTED` | reclaim em retry testado |
| Proteção contra comissão duplicada (`invoice.paid` + `payment_intent.succeeded`) | `IMPLEMENTED` | advisory lock por pagamento + `transaction_references` + ajuste `dup_` |
| Motor de comissão: percentual, fixo, recorrente com duração, retenção | `IMPLEMENTED` | `src/server/domain/commission.ts`, cobertura forte |
| Estorno e chargeback → reversão proporcional (nunca delete) | `IMPLEMENTED` | `billing-events.ts` |
| Disputa ganha → restauração da comissão | `IMPLEMENTED` (recente) | `charge.dispute.closed` → `disputeWon` |
| Ambiente test/live separado ponta a ponta | `IMPLEMENTED` | chaves, programas, clientes, transações, lotes, eventos |
| Conversão simulada no Sandbox (sem Stripe) | `IMPLEMENTED` | `src/server/services/sandbox.ts` |
| Portal do afiliado (ganhos, links, cliques, pagamentos) | `IMPLEMENTED` | `(affiliate)/affiliate/*`, isolamento por RLS testado |
| Lotes de pagamento + export CSV | `IMPLEMENTED` | `payouts.ts`, `csv.ts` (à prova de fórmula) |
| Analytics essencial (receita, comissões, cliques, clientes, conversão) | `IMPLEMENTED` | `repositories/analytics.ts`, teste por ambiente |
| Log de auditoria (Growth) | `IMPLEMENTED` | imutável para o role da aplicação |
| Planos, limites, Checkout, Portal, past_due/grace/cancelamento | `IMPLEMENTED` porém `UNVERIFIED` contra Stripe real | `PLAN_FEATURE_AUDIT.md` §B4 |
| Clawback de estorno **depois** da comissão paga | `PARTIALLY_IMPLEMENTED` | vira reversão, mas não é descontado de lote futuro (`LANDING_CLAIMS_AUDIT.md`, "Still open") |
| Pagamento automático ao afiliado (Pix, transferência, Connect) | **não existe, e é deliberado** | produto "não toca no dinheiro" |
| Paddle / Lemon Squeezy / Asaas / Iugu / Vindi / Pagar.me / Mercado Pago | `PLANNED` (tipo `"paddle"` existe no contrato, sem adapter) | `src/lib/billing/types.ts` |
| Stripe Connect OAuth (conectar com 1 clique) | `PARTIALLY_IMPLEMENTED` / rota legada | `STRIPE_CONNECT_CLIENT_ID` existe, endpoint legado existe, **não há fluxo de UI** |
| Webhooks de saída, API além de track/identify, domínio próprio, white-label, SLA, notificações | `PLANNED` (e corretamente **não prometidos** em lugar nenhum) | `PLAN_FEATURE_AUDIT.md` §B1 |
| Detecção de fraude / self-referral | **não existe** | nenhuma menção no código |
| Cupom como método de atribuição (sem cookie) | **não existe** | só `?ref=` + identify |

### Dívidas que impedem cobrar (do próprio audit interno)

- **P1-1 — a integração correta que não gera nada.** Se o primeiro `identify`
  vier **sem e-mail** e um evento do Stripe criar a linha do `cus_` antes, o
  segundo `identify` não consegue anexar o `providerCustomerId`, mantém `null`,
  **responde `200 {ok:true}`** e todo pagamento cai no cliente órfão. Nenhuma
  comissão, nunca, e ninguém é avisado. Para um produto de dinheiro isso é a
  falha mais cara que existe: o cliente descobre pelo afiliado reclamando.
- **P1-2 — chave única de `subscriptions` não é escopada por workspace.**
  Isolamento entre tenants.
- **Clawback ausente** — estorno depois do pagamento fica registrado mas não
  volta. Em programa recorrente com estorno isso vira discussão com afiliado.
- **Platform billing nunca rodou contra Stripe real.** O primeiro cliente pagante
  é o teste de produção da cobrança. Aceitável, mas é preciso saber disso.

---

# ICP

Não "empresas SaaS". Segmentos, com julgamento.

### ICP-1 · SaaS brasileiro pequeno (R$ 10k–100k MRR) que cobra em BRL
- **PAIN** média · **URGENCY** baixa · **BUDGET** R$ 100–300/mês é indolor
- **TECHNICAL_CAPABILITY** alta o bastante (chamar uma API é trivial)
- **CURRENT_ALTERNATIVE** cupom + planilha, ou nada
- **WILLINGNESS_TO_PAY** média — paga em real sem atrito, sem cartão internacional
- **SALES_DIFFICULTY** média
- **BLOQUEIO FATAL:** a maioria **não cobra pelo Stripe**. Cobra por Asaas, Iugu,
  Vindi, Pagar.me, Mercado Pago — porque precisa de Pix recorrente e boleto. Para
  esse ICP o produto hoje **não funciona**, por mais que o preço e o idioma
  sirvam. É o ICP mais confortável de vender e o menos atendível pelo código.

### ICP-2 · Founder brasileiro de SaaS/micro-SaaS que vende para fora, em USD, via Stripe ⭐
- **PAIN** média-alta · **URGENCY** média · **BUDGET** confortável (receita em
  dólar, custo em real)
- **TECHNICAL_CAPABILITY** alta — é indie hacker, integra sem suporte
- **CURRENT_ALTERNATIVE** Rewardful/Tolt em USD no cartão internacional, com IOF
  e câmbio, ou nada
- **WILLINGNESS_TO_PAY** alta relativa: R$ 99 é ~1/3 do Rewardful e sem dor de
  cobrança internacional
- **SALES_DIFFICULTY** **baixa** — é uma comunidade pequena, pública e alcançável
  (X/Twitter BR, TabNews, grupos de indie hackers BR, Product Hunt BR)
- **Este é o ICP principal.** É o único segmento onde Stripe + BRL + português
  deixam de ser contradição e viram encaixe.

### ICP-3 · Micro-SaaS/indie global (US/EU), US$ 2k–30k MRR, Stripe
- **PAIN** média · **URGENCY** baixa · **BUDGET** existe
- **CURRENT_ALTERNATIVE** Tolt $29–47, Affonso €15, Reditus free, Push Lap Growth
  $29 one-time, Rewardful $49
- **WILLINGNESS_TO_PAY** **já está sendo capturada por 5 concorrentes mais
  baratos ou iguais, com onboarding melhor**
- **SALES_DIFFICULTY** alta: canal saturado, sem marca, sem prova social, sem
  domínio
- Mercado maior, chance de ganhar menor. Segundo passo, não primeiro.

### ICP-4 · AI SaaS / wrappers (2024–2026)
- **PAIN** baixa-média — crescem por conteúdo e comunidade, não por afiliado
  estruturado; alta rotatividade de produto
- **RETENTION** péssima (o próprio SaaS morre)
- Não perseguir.

### ICP-5 · Infoproduto / creator BR
- **PAIN** alta, **BUDGET** alto, **URGENCY** alta — mas **Hotmart, Kiwify,
  Eduzz, Cakto e Lastlink já resolvem com afiliado nativo, checkout e pagamento
  automático**. O IndicaFluxo não tem checkout nem paga ninguém. Perde de forma
  categórica. Não perseguir.

**ICP principal: ICP-2.** Secundário e só depois de tração: ICP-3.

---

# Problem

| Dor | SEVERITY | FREQUENCY | URGENCY | CURRENT_SOLUTION | COST_OF_NOT_SOLVING | Veredito |
| --- | --- | --- | --- | --- | --- | --- |
| Construir o sistema internamente | alta | uma vez | alta *no momento da decisão* | 2–8 semanas de dev | 2 meses de engenharia + manutenção eterna | **PAINKILLER** |
| Atribuição correta (2 afiliados, janela, renovação) | alta | contínua | média | cupom (perde dado) ou nada | pagamento errado, briga com parceiro | **PAINKILLER** |
| Comissão recorrente por N meses | alta | mensal | alta | planilha | erro composto todo mês | **PAINKILLER** |
| Estorno reverter comissão já calculada | alta | esporádica | alta quando ocorre | ninguém percebe | paga-se comissão sobre dinheiro devolvido | **PAINKILLER** |
| Webhook duplicado gerar comissão dupla | alta | invisível | alta | ninguém sabe que tem | prejuízo silencioso | **PAINKILLER** (e é o melhor argumento de venda do produto) |
| Conciliar quanto pagar a cada afiliado | média | mensal | média | planilha | 1–3 horas/mês + erro | painkiller fraco |
| Portal para o afiliado acompanhar | média | contínua | média | e-mail manual | atrito com parceiro, afiliado desengaja | **NICE_TO_HAVE** que vira painkiller acima de ~15 afiliados |
| Dashboard de performance por afiliado | baixa | semanal | baixa | Stripe + planilha | curiosidade | **NICE_TO_HAVE** |
| Log de auditoria (Growth) | baixa | rara | baixa | nada | nenhum | **NICE_TO_HAVE** — e é feature paga; ver *Pricing* |
| Test/live separado | média | uma vez | média | testar em produção e rezar | medo de ativar | painkiller de *onboarding*, não de operação |

**Conclusão dura:** o conjunto é painkiller — mas **só depois que o programa
existe e tem volume**. Antes disso, tudo acima é hipotético para o comprador. O
produto vende alívio de uma dor que o cliente ainda não sentiu. Esse é o
problema comercial número um, e nenhuma feature o resolve. Só copy e canal.

---

# Buying Trigger

Ordenado por força real:

1. **"Um afiliado/parceiro me pediu link e eu não tenho como medir."** ⭐ mais
   forte. É pontual, urgente, e o founder resolve na mesma semana.
2. **"Vou lançar programa de afiliados este mês."** Forte e planejado — é o
   momento em que ele *pesquisa* ferramenta. É o único trigger com intenção de
   busca ("affiliate software for SaaS"), e nele o IndicaFluxo perde para quem
   tem SEO, ou seja, todo mundo.
3. **"Paguei comissão errada / paguei sobre venda estornada."** Forte, raro,
   tardio, e quem chega aqui já tem uma ferramenta ou uma planilha grande.
4. **"Passei de 10–20 afiliados e a planilha quebrou."** Forte, mas raríssimo —
   a maioria dos programas morre antes de chegar a 10 afiliados ativos.
5. **"Quero comissão recorrente e não sei calcular."** Médio.
6. **"O Rewardful ficou caro / bati o teto de receita."** ⭐ Trigger **de troca**,
   e é o mais interessante comercialmente: o comprador já está educado, já paga,
   já tem programa funcionando, e tem um motivo concreto (teto de US$ 7.500 no
   Starter do Rewardful; 2,9% de fee no Tolt). É o único trigger em que o
   IndicaFluxo entra numa conversa em que o valor já está provado.

**O trigger mais forte alcançável hoje: #1 e #6.** O #2 exige SEO que não
existe. Estratégia de aquisição deve atacar #1 (busca ativa por sinais) e #6
(dor de preço/teto em quem já paga).

---

# Current Alternatives

| Alternativa | Por que ganha do IndicaFluxo | Por que perde |
| --- | --- | --- |
| **DO NOTHING** (não ter programa) | custo zero, esforço zero; a maioria dos SaaS pequenos não faz afiliado e vai bem | não captura canal barato quando paid media encarece |
| **Cupom manual** (`cupom AFILIADO10` no Stripe) | 5 minutos, zero código, zero custo, funciona sem cookie e sem `identify` | não atribui renovação, não reverte estorno, não calcula recorrente, quebra com múltiplos afiliados, não tem portal |
| **Planilha + Stripe dashboard** | grátis, o founder já sabe usar | erra silenciosamente, não escala além de ~10 afiliados, consome 1–3h/mês |
| **Build it yourself** | controle total, sem mensalidade, "é só um cookie" | é 2 meses, não 2 dias — este repositório é a prova (51k linhas, 308 contratos auditados). Ainda assim, **para o founder que acha que é 2 dias, esta é a alternativa mais perigosa** porque ele só descobre o custo depois |
| **Lemon Squeezy / Paddle / Gumroad** (afiliado nativo do MoR) | grátis, já embutido no checkout, paga o afiliado automaticamente | exige migrar de merchant of record — mas quem já está lá **nunca será cliente** |
| **Hotmart / Kiwify / Cakto / Lastlink (BR)** | afiliado nativo, checkout, pagamento automático ao afiliado | não servem SaaS por assinatura com cobrança própria |
| **Rewardful / FirstPromoter / Tolt / Affonso / Reditus** | marca, SEO, prova social, Stripe OAuth de 1 clique, integração sem chamada de backend, apps prontos | preço/teto/fee (ver matriz) |

**O concorrente número um do IndicaFluxo não é o Rewardful. É o cupom e o "não
fazer".** Isso muda o que a landing precisa dizer: hoje ela compara o produto com
*construir do zero*, que é a alternativa que o cliente menos considera.

---

# Market

`MARKET_RESEARCH_LIMITATION`: houve acesso à internet e a pesquisa é de
2026-09-17, mas ela cobre **páginas de fornecedores, comparativos e diretórios**.
Não houve acesso direto a threads do Reddit, G2, Capterra ou Indie Hackers com
citações verbatim de usuários; o que aparece abaixo como "reclamação" vem de
páginas de comparação (frequentemente escritas por concorrentes) e de resumos de
review. Trate como **sinal**, não como evidência primária. Falar com 10 founders
vale mais que toda esta seção.

**O que a pesquisa sustenta:**

- O mercado é **maduro e povoado**: Rewardful, FirstPromoter, Tapfiliate, Tolt,
  PartnerStack, Impact, Affonso, Reditus, Push Lap Growth, LinkJolt, Kiflo,
  Dub Partners, Track360, Refgrow. Existe até "market map com 31 vendors".
- A faixa indie consolidou em **US$ 29–49/mês**, com free tier (Reditus) e até
  pagamento único (Push Lap Growth, US$ 29 one-time).
- A faixa de referência para SaaS sério é **US$ 49–149/mês**.
- **Os modelos punem sucesso de três maneiras**: teto de receita atribuída
  (Rewardful Starter: US$ 7.500/mês; FirstPromoter: US$ 5.000/mês), taxa por
  transação (Tolt: 2,9% + $0,30) ou percentual da receita (Rewardful chegando a
  9% em planos baixos, segundo comparativos).
- O canal de afiliados **funciona** para SaaS: programas maduros reportam 15–25%
  do MRR; comissão mediana B2B ~20%. Ou seja, a dor é economicamente relevante
  para quem leva a sério.
- **Brasil:** o ecossistema de cobrança recorrente é Asaas / Iugu / Vindi /
  Pagar.me / Mercado Pago, por causa de Pix recorrente e boleto. Stripe se
  consolidou localmente só recentemente e é mais comum em quem vende para fora.
  Não encontrei nenhum concorrente **brasileiro** de afiliados para SaaS por
  assinatura. Isso é ao mesmo tempo o sinal de oportunidade e o sinal de alerta:
  ninguém construiu porque o mercado local que usa Stripe é pequeno.

**Tamanho honesto do ICP-2 (founder BR, Stripe, vendendo fora):** na casa das
centenas a poucos milhares de empresas, não dezenas de milhares. A R$ 197/mês,
1.000 clientes seria ~R$ 2,4M ARR — teto real, mas teto de micro-SaaS excelente.
Capturar 1% desse ICP em 12 meses é otimista; capturar 30 clientes em 6 meses é
realista e já é um negócio.

---

# Competition

Matriz factual. `?` = não verificado nesta sessão. Preços de setembro/2026,
das páginas dos próprios fornecedores e de comparativos.

| | **IndicaFluxo** | Rewardful | FirstPromoter | Tolt | Affonso | Reditus | Push Lap Growth |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Preço inicial | **R$ 99 (~US$ 18)** | US$ 49 | US$ 49 | US$ 29–47 | €15 | free tier | US$ 29 one-time |
| Preço seguinte | **R$ 197 (~US$ 36)** | US$ 99 / 149 | US$ 99 / 149+ | US$ 69 / 99 / 199 | ? | ? | US$ 75 / 149 |
| **Teto de receita atribuída** | **nenhum** ⭐ | US$ 7.500 no Starter | US$ 5.000 no inicial | ? | ? | ? | US$ 5.000 no Indie |
| **Taxa sobre transação** | **0%** ⭐ | até 9% em planos baixos | 0% | 2,9% + $0,30 | ? | ? | ? |
| Stripe | sim | sim | sim | sim | sim | sim | sim |
| Paddle / outros | **não** | não | sim | sim | ? | ? | ? |
| **Conexão Stripe** | **manual: acct_id + endpoint + 10 eventos + whsec_** ❌ | **OAuth 1 clique** | OAuth | OAuth | OAuth | OAuth | OAuth |
| **Exige chamada de backend?** | **sim, `/api/identify` obrigatório** ❌ | não (JS + `client_reference_id`) | não | não | não | não | não |
| Comissão recorrente | sim | sim | sim | sim | sim | sim | sim |
| Retenção (hold) | sim | sim | sim | sim | ? | ? | ? |
| Estorno → reversão | sim, proporcional | sim | sim | sim | ? | ? | ? |
| Clawback pós-pagamento | **não** | ? | ? | ? | ? | ? | ? |
| Portal do afiliado | sim | sim (externo) | sim (externo) | sim + **widget embutido e domínio próprio** | sim | sim | sim |
| Domínio próprio | **não** | pago | sim | sim | ? | ? | ? |
| Pagamento automático ao afiliado | **não (por decisão)** | PayPal/Wise | sim | sim | ? | ? | ? |
| Multi-moeda | por programa | sim | sim | sim | ? | ? | ? |
| Antifraude | **não** | básico | sim | ? | ? | ? | ? |
| API pública | **só track/identify** | sim | sim | sim | ? | ? | ? |
| Webhooks de saída | **não** | sim | sim | ? | ? | ? | ? |
| Marketplace de afiliados | **não** | não | não | não | não | **sim** ⭐ | não |
| Test/sandbox real | **sim, com conversão simulada** ⭐ | modo teste do Stripe | ? | ? | ? | ? | ? |
| pt-BR nativo / cobrança em BRL | **sim** ⭐ | não | não | não | não | não | não |
| Marca / SEO / prova social | **zero** ❌ | forte | forte | forte | crescendo | média | média |

**Onde o IndicaFluxo perde, sem rodeio:** onboarding (o pior da lista), ausência
de Paddle, ausência de pagamento ao afiliado, ausência de antifraude, ausência de
domínio próprio, ausência de API/webhooks, e — o mais caro — **ausência total de
marca, SEO e prova social** num mercado onde a decisão começa com uma busca.

**Onde ganha, com respaldo no código:** sem teto de receita, sem percentual, sem
taxa por transação, sandbox com conversão simulada de verdade, português nativo,
cobrança em BRL, e um nível de honestidade documental (o `/docs` explica até os
casos em que **você não ganha comissão**) que nenhum concorrente oferece.

---

# Differentiation

## Por que alguém escolheria IndicaFluxo em vez de Rewardful/Tolt/FirstPromoter?

Respostas concretas, sem "interface melhor":

1. **Economia real e crescente com o sucesso do cliente.** Um SaaS com US$ 20k/mês
   de receita atribuída a afiliados paga: Rewardful ≥ US$ 149 (estourou o teto
   duas vezes), Tolt ~US$ 99 + 2,9% de US$ 20k = **US$ 679/mês**, IndicaFluxo
   **R$ 197 (~US$ 36)**. Isso não é "mais barato", é **uma ordem de grandeza**, e
   é sustentado pelo código (não existe percentual em lugar nenhum). Esta é a
   única afirmação de diferenciação que resiste a escrutínio hoje.
2. **Pagar em real, nota em real, sem cartão internacional, sem IOF, sem
   câmbio.** Para o founder brasileiro isso não é conforto, é fricção
   administrativa removida. É um argumento pequeno em inglês e grande em
   português.
3. **Produto e suporte em português, pelo próprio autor.** Para o ICP-2, suporte
   em português no fuso certo é decisão de compra em ferramenta que mexe com
   dinheiro.
4. **Sandbox que prova a integração antes de pagar qualquer coisa,** com
   conversão simulada passando pelo pipeline real. Reduz o risco percebido de
   "vou pagar e descobrir que não funciona com meu stack".
5. **Transparência auditável.** Cada comissão guarda a regra que a gerou; correções
   viram registros novos; a tela de conversão mostra o caminho do clique à
   comissão. Em produto de dinheiro, "eu consigo provar ao afiliado por que esse
   valor é esse" tem valor comercial concreto — evita a discussão que destrói a
   relação com parceiro.

## E o que NÃO é diferencial, por mais tentador que pareça

- "Arquitetura melhor", "RLS", "sem float", "idempotência": o comprador assume
  que todo concorrente faz isso. Não vende. **Serve de razão para confiar depois
  que ele já está interessado**, não antes.
- "UI moderna": Tolt e Affonso também têm.
- "Documentação excelente": aumenta conversão de quem já chegou; não traz ninguém.

## Veredito

**Existe um wedge, mas ele é estreito e é de preço + localidade, não de
produto.** Isso é frágil (preço se copia) porém suficiente para os primeiros 30
clientes. `WEAK_POSITIONING` **não** se aplica, desde que o posicionamento seja o
do ICP-2. Se o posicionamento continuar "infraestrutura de afiliados para SaaS"
em geral, aí sim: `WEAK_POSITIONING`.

---

# Why Now

Tendências só valem conectadas. As que conectam:

- **Custo de mídia paga subiu e continua subindo** → founders procuram canais de
  performance sem CAC fixo → afiliado volta à pauta. *Conexão: real, mas lenta —
  não cria urgência de compra numa semana específica.*
- **Stripe se consolidou no Brasil (operação local recente)** → existe agora uma
  massa crescente de SaaS brasileiro cobrando via Stripe que antes não existia, e
  **nenhum fornecedor local de afiliados atende esse recorte**. *Conexão: esta é
  a melhor justificativa de "why now" que o projeto tem, e é específica.*
- **Onda de micro-SaaS e de SaaS construído com IA** → mais produtos, cada um
  menor, cada um sensível a mensalidade em dólar. *Conexão: real, mas esses
  produtos também morrem rápido (risco de churn).*
- **Concorrentes subiram preço e mantiveram teto de receita** → cria trigger de
  troca. *Conexão: real e acionável hoje.*

Não conecta: "IA", "PLG", "creator economy". Nada no IndicaFluxo depende delas.

---

# Pricing

## Disposição a pagar, por faixa

Referência de sanidade: se o programa de afiliados gera R$ 5.000/mês de receita
nova, qualquer preço abaixo de R$ 300 é ruído. Se gera R$ 0, **qualquer** preço é
caro. O preço não é limitado pelo valor entregue — é limitado pela **incerteza de
o canal funcionar**. Isso empurra para preço baixo de entrada.

| Faixa | Quem pagaria | Quando | Avaliação |
| --- | --- | --- | --- |
| US$ 19 / R$ 99 | indie com 1–10 afiliados | ao ir para produção | **entrada certa.** Baixo o bastante para não exigir business case |
| US$ 29 / R$ 149 | mesmo perfil | mesmo momento | **provavelmente o ponto ótimo de entrada** — ainda impulso, +50% de receita |
| US$ 49 / R$ 249 | SaaS com programa funcionando, 10–50 afiliados | após ver a 1ª comissão | plausível, exige valor comprovado |
| US$ 79–99 / R$ 397–497 | SaaS com afiliado como canal real | após 3 meses de uso | **só com pagamento ao afiliado, antifraude e API** — hoje não se sustenta |
| US$ 149+ | não é este produto | — | exige time, SLA, multi-provider |

**Diagnóstico do preço atual:** R$ 99 / R$ 197 está **certo em nível e errado em
moeda e em eixo**.
- Certo em nível: barato o suficiente para o trigger fraco.
- Errado em moeda: a página em inglês mostra **R$**. Um comprador americano não
  converte mentalmente e a maioria abandona. Ou assume-se BR e a página em inglês
  é um passivo, ou cria-se preço em USD.
- **Errado em eixo, e este é o erro mais caro:** a diferença Launch → Growth é
  *afiliados ilimitados + taxa customizada + log de auditoria*. O cliente sobe de
  plano quando passa de 100 afiliados — o que quase nunca acontece. Resultado:
  **o preço não cresce com o sucesso do cliente, em nenhuma direção.** Expansion
  revenue ≈ 0, NRR ≈ 100% menos churn. Para micro-SaaS isso é aceitável, mas
  significa que todo crescimento tem que vir de aquisição nova, para sempre.
- **Taxa customizada por afiliado atrás do plano caro é um erro de gating.** É a
  feature que o founder quer exatamente quando consegue *o primeiro parceiro
  grande* — momento em que ele tem 3 afiliados, não 100. Ele bate na parede cedo,
  por um motivo que não tem nada a ver com escala. Mover para Launch.
- **Log de auditoria como feature paga** não convence ninguém a pagar R$ 98 a
  mais. É higiene, não valor.

## Modelos, com prós e contras

| Modelo | A favor | Contra | Serve aqui? |
| --- | --- | --- | --- |
| **Flat mensal** | simples, previsível, não pune sucesso, vende fácil | zero expansão, teto de ARPU | **sim, é o atual e é o certo para começar** |
| Por receita atribuída | alinha preço a valor; é o padrão do mercado | pune sucesso, cria a dor que hoje é seu wedge, exige contadoria | **não** — destruiria a única diferenciação |
| Por nº de afiliados | fácil de entender, cresce um pouco | pune convite de afiliado, que é o comportamento que você quer incentivar | não como eixo principal |
| Por nº de afiliados **ativos** (com clique ou comissão no mês) | cresce só quando o programa funciona; não pune convidar | mais difícil de explicar | **sim — é o melhor eixo de expansão para a v2** |
| Por conversões rastreadas | alinhado a valor | volátil, imprevisível | não |
| % da receita do afiliado | máximo alinhamento | mata o wedge, exige confiança que você ainda não tem | **não** |
| Híbrido flat + ativos | equilíbrio | complexidade | v2 |

## Estrutura recomendada para testar

Manter três degraus, trocar o eixo de "limites administrativos" para "tamanho do
programa em operação":

```
Sandbox        R$ 0      teste, sem prazo, sem cartão (manter exatamente como está)
Launch         R$ 149    produção, programas ilimitados, até 15 afiliados ATIVOS/mês,
                         taxa customizada incluída, 2 pessoas
Growth         R$ 349    até 75 afiliados ATIVOS/mês, 10 pessoas, log de auditoria,
                         suporte prioritário em português
(Scale)        sob medida — só quando existir algo exclusivo de verdade
```

Racional: "afiliado ativo no mês" só cresce quando o programa **está dando certo**,
o que torna o aumento defensável e não punitivo. Mantém 0% de taxa e nenhum teto
de receita — o wedge permanece intacto e vira headline: **"Sem taxa sobre a sua
receita. Sem teto de faturamento. Nunca."**

Para o ICP-3 (global), quando for a hora: US$ 29 / US$ 69 com o mesmo eixo.

**Aviso:** não troque o eixo agora. Troque quando tiver 5 clientes pagantes e
souber quantos afiliados ativos eles realmente têm. Trocar antes é adivinhar.

---

# Time-to-Value

Simulação do founder, medida no produto real (`/en/docs` diz "cerca de 15 minutos
em modo de teste" — a estimativa é honesta para quem tem tudo em mãos, e otimista
para quem não tem).

| Etapa | Esforço | FRICTION | Risco |
| --- | --- | --- | --- |
| Landing → Signup | 1 min | baixa | — |
| Confirmar e-mail (Supabase) | 1–5 min | **média** | `DROP_OFF_RISK` — o link PKCE só funciona no mesmo navegador; quem abre no celular vê "link expirado" |
| Criar workspace | 1 min | baixa | — |
| Criar programa (regra, janela, retenção, modelo de atribuição) | 3–8 min | **média** | `CONFUSION` — first vs last click, janela, retenção: 4 decisões que o founder nunca tomou antes e não sabe quais são "normais" |
| Convidar e **aprovar** um afiliado | 2 min | baixa | `CONFUSION` — só participação aprovada gera comissão; é fácil esquecer de aprovar |
| Gerar chaves (pk/sk de teste) | 1 min | baixa | chave mostrada uma vez só |
| **Instalar `/t.js` no site** | 5–20 min | **alta** | `TECHNICAL_BARRIER` — exige deploy do site |
| **Chamar `POST /api/identify` no backend** | **20–90 min** | **a mais alta de todas** | `TECHNICAL_BARRIER` + `DROP_OFF_RISK` máximo. Exige escrever código, ler cookie, tratar subdomínio, e **fazer deploy do backend**. Nenhum concorrente exige isso |
| Criar endpoint de webhook no Stripe + **selecionar 10 eventos** + colar `whsec_` + `acct_` | 10–15 min | **alta** | `FRICTION` — trabalho manual e propenso a erro; concorrentes fazem com OAuth de um clique |
| Simular conversão no Sandbox | 1 min | **muito baixa** ⭐ | melhor momento do produto |
| Primeira comissão de verdade | dias a semanas | — | depende do afiliado, não do produto |

**Tempo realista até o primeiro valor: 1 a 3 horas de trabalho técnico,
distribuídas em ≥1 deploy de backend.** Contra ~15 minutos e zero código no
Rewardful/Tolt. **Esta é a maior desvantagem competitiva do produto, maior que
preço, marca ou features.**

**Ponto positivo:** a conversão simulada do Sandbox permite ver o pipeline
funcionando *antes* do Stripe. Isso é genuinamente melhor que os concorrentes e
está sub-explorado — hoje é um botão dentro do produto, deveria ser a promessa
da landing.

## AHA MOMENT e ACTIVATION EVENT

- **AHA MOMENT (emocional):** ver a **conversão simulada** virar comissão com a
  regra aplicada e o caminho clique → cliente → pagamento → comissão na tela.
  Acontece **antes** de qualquer integração. Hoje está escondido.
- **ACTIVATION EVENT (o que prever churn):** **primeira comissão em programa
  live**, gerada por um clique real de um afiliado real. É o `liveMode` +
  `hasLiveCommission` que o próprio `activation.ts` já modela — o código já sabe
  a resposta certa.
- **Métrica intermediária mais importante:** `attributionsBound > 0` no primeiro
  `identify`. É o instante em que o founder descobre se a integração está certa.
  Deveria disparar um e-mail de "funcionou".

---

# Activation (onboarding)

O que existe: `ACTIVATION_STEPS` (workspace → programa → stripe → afiliado →
conversão de teste → tracking → live mode), checklist na overview, regra fina de
quando mostrar checklist vs dashboard, badge de Stripe que **só fica verde depois
de um evento real chegar** (honestidade rara e boa), aviso de chave de teste,
aviso de HTTP, dica de subdomínio.

Isso é um onboarding **acima da média** para um produto de 4 dias. Os problemas
não são de qualidade, são de ordem e de promessa:

1. **A ordem está tecnicamente correta e comercialmente errada.** O checklist
   pede Stripe (passo 3) antes da conversão de teste (passo 5). Mas o Sandbox
   consegue simular conversão **sem Stripe nenhum**. O founder deveria chegar ao
   aha em 3 minutos: criar programa → criar afiliado → **simular** → ver comissão.
   Stripe e `identify` viriam depois, já convencido.
2. **Não existe simulador antes do login.** Um `/demo` público, com dados fixos,
   mostrando clique → conversão → comissão → reversão de estorno, converteria
   melhor que a landing inteira. O produto tem todo o motor para isso.
3. **`identify` não tem ferramenta de diagnóstico.** `attributionsBound: 0` é um
   número; deveria ser uma tela ("recebemos seu identify, mas esse visitorId não
   tem atribuição aberta — possíveis causas: ..."). Como o P1-1 mostra, dá para o
   founder receber `200 ok` e nunca ganhar nada. **É a origem número um do
   suporte futuro.**
4. **Não há checklist com estimativa de tempo nem "cole isso no seu backend" em
   framework real** (Next route handler, Express, Rails, Laravel). Os snippets
   existem em cURL e TypeScript genérico; um snippet por framework popular tira
   30 minutos do caminho.

---

# Retention

**Razões para continuar pagando** (do mais forte ao mais fraco):

1. **Comissão recorrente em curso.** Se o afiliado ganha 20% por 12 meses, parar
   de pagar o IndicaFluxo significa parar de saber quanto deve. Este é o único
   lock-in forte do produto, e só existe em programas com duração recorrente.
2. **Histórico e ledger.** Dados de meses anteriores, prova de por que cada
   comissão foi o que foi. Tem valor real em disputa com afiliado.
3. **Links de afiliados em circulação.** Trocar de ferramenta invalida links que
   parceiros já publicaram em blog, YouTube, newsletter. `SWITCHING COST` real.
4. **Portal que o afiliado já usa.** Migrar significa pedir a N parceiros que
   recadastrem. Atrito social.
5. **Código instalado** (`t.js` + `identify` no backend). Trocar exige outro
   deploy. Ironicamente, **a fricção de onboarding vira retenção depois.**

**Razões para cancelar:**

1. **O programa não gerou vendas.** Mata tudo. Nenhuma feature protege.
2. Poucos afiliados ativos — R$ 99 por 2 afiliados parece caro.
3. Founder desistiu de afiliados como canal (muito comum).
4. O SaaS do cliente morreu (altíssimo entre micro-SaaS).
5. Migrou de gateway (foi para Paddle/Lemon/Asaas) — **e aí não há Plano B**.
6. Achou que dava para resolver com cupom.

**Switching cost: `MEDIUM`.** Alto tecnicamente (código + links + portal), baixo
emocionalmente (se não gera dinheiro, ninguém tem apego). O switching cost só
protege quem **já teve sucesso** — e quem teve sucesso não queria sair mesmo.
Ou seja: o lock-in não protege contra a causa real de churn.

---

# Churn Risks

Ordenados por probabilidade × impacto:

1. 🔴 **O programa de afiliados do cliente não gera vendas.** Probabilidade alta
   (a maioria dos programas de SaaS pequeno gera pouco no primeiro semestre),
   impacto total. **Este é, de longe, o maior risco do negócio inteiro.** O
   produto entrega o que promete e mesmo assim é cancelado — porque o valor
   percebido está amarrado a um resultado que não depende dele.
   *Mitigação possível:* deixar de vender só "infraestrutura" e passar a ajudar
   o founder a **conseguir afiliados** (templates de convite, página pública de
   programa, kit de materiais, diretório). Isso desloca o produto de "contador"
   para "gerador de canal" — é a mudança de escopo mais defensável que existe
   aqui, e é a única coisa que ataca o churn na raiz.
2. 🔴 **Founder abandona afiliados como canal.** Alta probabilidade, mesma causa.
3. 🟠 **O SaaS cliente morre.** Alta entre micro-SaaS; inevitável.
4. 🟠 **Integração quebra silenciosamente e o cliente perde confiança.** Já existe
   o vetor (P1-1). Em produto de dinheiro, um erro silencioso custa o cliente e a
   reputação.
5. 🟠 **Cliente migra de Stripe.** Sem Paddle/Lemon/Asaas, é churn compulsório.
6. 🟡 **Concorrente baixa preço.** O wedge é preço; preço se copia em uma tarde.
7. 🟡 **Founder internaliza.** Baixo — quem já pagou não volta a construir.

---

# Unit Economics

Cenários com hipóteses explícitas. Nenhum número aqui é medido; são estimativas
de ordem de grandeza para decidir, não para planilha de investidor.

**Hipóteses:** Vercel + Supabase; preço médio R$ 197/cliente (mix Launch/Growth);
cada cliente = 1 programa, ~20 afiliados, ~50k cliques/mês, ~2k eventos de
webhook/mês; suporte feito pelo founder; sem custo de aquisição pago.

| Clientes | MRR | Infra/mês | Margem bruta | Horas de suporte/mês | Observação |
| --- | --- | --- | --- | --- | --- |
| 10 | R$ 1.970 | ~R$ 250 (free tiers quase suficientes) | **~87%** | 8–20h | cada cliente é um projeto de integração; margem contábil ótima, margem de tempo péssima |
| 50 | R$ 9.850 | ~R$ 600 (Supabase Pro + Vercel Pro) | **~94%** | 20–40h | ponto em que suporte vira trabalho de meio período |
| 100 | R$ 19.700 | ~R$ 1.200 | **~94%** | 30–60h | precisa de status page, alertas e autoatendimento de diagnóstico |
| 500 | R$ 98.500 | ~R$ 4.000–7.000 (volume de cliques domina, réplicas de leitura, retenção de dados) | **~93%** | precisa de 1 pessoa dedicada | `/api/track` e o particionamento de `clicks` viram o problema técnico principal |
| 1.000 | R$ 197.000 | ~R$ 10.000–18.000 | **~91%** | 2 pessoas | negócio real; custo de compliance fiscal e financeiro aparece |

**Conclusões que importam mais que os números:**
- **Margem bruta não é o risco.** É software puro, sem custo variável relevante e
  sem movimentação de dinheiro (decisão excelente: nada de KYC, escrow, licença
  de pagamento, PCI).
- **O custo real é hora de founder por cliente**, e ele é alto **por causa da
  fricção de onboarding**. A cada 30 minutos cortados do caminho de integração,
  a economia unitária melhora mais do que com qualquer otimização de infra.
- **`/api/track` é o único custo que escala com o sucesso do cliente** e não está
  precificado. Um cliente com 5M de cliques/mês paga o mesmo que um com 5 mil.
  Não é problema hoje; é a razão técnica para o eixo de preço evoluir.

---

# Support Burden

O produto tem **alto potencial de suporte** por natureza: rastreamento + dinheiro
+ código do cliente + Stripe. Os chamados previsíveis:

| Chamado | Origem provável | O produto já ajuda? |
| --- | --- | --- |
| "Minha indicação não rastreou" | cookie bloqueado (Safari ITP ~7 dias), `data-cookie-domain` faltando, script não está na página de cadastro | **parcial** — docs excelentes, mas nenhuma tela de diagnóstico |
| "`attributionsBound: 0`" | visitorId errado, janela expirada, ambiente trocado | **parcial** — a doc lista as 5 causas; o produto não |
| "O Stripe não mandou nada" | eventos errados selecionados, secret errado, Thin payload | **bom** — badge só fica verde com evento real, tela de Integrações mostra estado |
| "Comissão errada" | regra, janela, retenção, taxa customizada | **muito bom** — `rule_applied` guarda a regra, tela de conversão mostra o caminho |
| "Pagamento sem comissão" | pagamento sem Stripe customer (Payment Link sem `customer_creation`), e-mail divergente, **P1-1** | **insuficiente** — é a falha silenciosa; deveria haver alerta ativo |
| "Estorno não reverteu" | ordem de eventos | **bom** — reversões testadas, incluindo estorno antes do pagamento |
| "Afiliado diz que falta conversão" | qualquer um dos acima | requer investigação manual do founder, caso a caso |

**Avaliação:** a arquitetura e a documentação **reduzem materialmente** o risco de
suporte em relação a um produto médio — idempotência, `rule_applied`, trilha da
conversão, badge honesto, erros com códigos estáveis. Mas falta a peça que mais
economiza tempo: **uma tela de diagnóstico de integração** ("últimos 20 eventos
recebidos, últimos identify, últimos cliques, e o que cada um resolveu ou não").
Com 10 clientes isso é o único item de produto que eu construiria.

---

# Trust

O produto mexe com atribuição e dinheiro, então confiança é requisito, não
diferencial. Situação:

| Sinal de confiança | Status |
| --- | --- |
| Idempotência de webhook | ✅ implementada e testada |
| Ledger append-only, reversões em vez de delete | ✅ |
| Regra registrada em cada comissão (`rule_applied`) | ✅ |
| Trilha da conversão (clique → cliente → pagamento → comissão) | ✅ |
| Log de auditoria | ✅ (atrás do Growth — **deveria estar em todos**) |
| Dinheiro inteiro em unidade menor + ISO-4217 | ✅ |
| E-mail de cliente como hash | ✅ |
| RLS + role de aplicação, Data API fechada | ✅ |
| Não toca no dinheiro de ninguém | ✅ decisão estratégica correta |
| **Clawback de estorno pós-pagamento** | ❌ ausente |
| **Alerta ativo de "pagamento chegou e não gerou comissão"** | ❌ ausente — e é o mais importante |
| **Domínio próprio, HTTPS, página de status** | ❌ inexistentes |
| **Prova social, termos de uso, política de privacidade, CNPJ, contato** | ❌ inexistentes |
| Cobrança verificada contra Stripe real | ❌ nunca rodou |

**Veredito:** tecnicamente o produto é confiável acima do que o mercado exige.
**Comercialmente ele não transmite confiança alguma** — porque não tem domínio,
não tem página de status, não tem termos, não tem rosto e não tem um único
cliente citável. Para um produto que pede o signing secret do Stripe do cliente,
isso é um bloqueio de conversão, não um detalhe.

---

# Feature Gaps

Classificação agressiva, como pedido.

## MUST HAVE BEFORE SELLING (sem isso não se cobra)

1. **Deploy em domínio próprio** com HTTPS, `NEXT_PUBLIC_APP_URL` correto,
   e-mails do Supabase configurados. `indicafluxo.com` e `.com.br` estão livres.
2. **Corrigir o P1-1** (`identify` que responde `200 ok` e nunca gera comissão).
   Alternativa mínima aceitável: responder com aviso explícito e mostrar na tela
   de Integrações "pagamentos recebidos sem comissão: N".
3. **Alerta de "pagamento sem comissão"** visível no dashboard. É a diferença
   entre descobrir em 1 hora e descobrir pela boca do afiliado em 2 meses.
4. **Verificar a cobrança contra um Stripe real** — um ciclo completo: checkout,
   webhook, portal, troca de plano, cancelamento, past_due.
5. **Termos de uso, política de privacidade, página de contato, dado do
   responsável.** Ninguém cola signing secret num site anônimo.
6. **Canal de suporte declarado** (e-mail + WhatsApp/Discord) com tempo de
   resposta prometido.

## IMPORTANT BUT CAN WAIT (entre o 1º e o 10º cliente)

7. Tela de diagnóstico de integração (eventos, identify, cliques recentes e o que
   cada um resolveu).
8. Snippets de `identify` por framework (Next.js, Express, Rails, Laravel, Django).
9. Demo pública sem login mostrando o pipeline inteiro.
10. Clawback de estorno pós-pagamento (ou, no mínimo, aviso explícito no lote).
11. Mover taxa customizada por afiliado para o Launch.
12. E-mail transacional de "sua primeira comissão" e "primeiro identify bem-sucedido".
13. Preço em USD se o ICP-3 entrar em jogo.

## NICE TO HAVE

14. Página pública do programa (`/afiliados`) gerada pelo IndicaFluxo — ajuda o
    cliente a **conseguir afiliados**, que é a raiz do churn.
15. Widget de portal embutido / domínio próprio (paridade com Tolt).
16. Materiais para afiliado (banners, textos prontos).
17. Webhooks de saída.

## DO NOT BUILD YET

18. **Pagamento automático ao afiliado (Pix, Stripe Connect, wallets, KYC).**
    Muda o produto de software para infraestrutura financeira regulada. Mataria o
    roadmap por 6 meses. A decisão atual de "não tocamos no dinheiro" é uma das
    melhores decisões do projeto — mantenha.
19. Antifraude com ML.
20. Marketplace de afiliados.
21. Paddle / Lemon Squeezy / Asaas / Iugu — **exceto** se a validação mostrar que
    o gateway é o motivo número um de "não dá para usar". Aí Asaas vira o item #1
    do roadmap e muda o ICP inteiro.
22. Permissões granulares, SSO, SLA, plano Scale.
23. Multi-moeda avançada, domínio próprio por workspace, white-label.

---

# Go-to-Market

## Os primeiros 10 clientes — ações concretas

Nada de "faça marketing de conteúdo". Ordem de execução:

**1. Caça a sinal de intenção já existente (o melhor canal).** Encontre SaaS que
**já têm** programa de afiliados mal resolvido — eles já passaram pelo trigger:
- Busque no Google: `site:*.com.br "programa de afiliados" SaaS`,
  `"seja um afiliado" software assinatura`, `inurl:afiliados SaaS`,
  `"programa de parceiros" "por indicação"` — e as versões em inglês
  `inurl:/affiliates "powered by"`.
- Liste quem usa concorrente: páginas de afiliado hospedadas em `*.rewardful.com`,
  `*.getrewardful.com`, `*.firstpromoter.com`, `*.tolt.io`. **Cada um desses é um
  cliente educado, com programa rodando, pagando em dólar.** É a lista de
  prospecção mais valiosa que existe para este produto.
- Abordagem: não venda ferramenta. Ofereça a conta. "Vi que você usa X. Com Y de
  receita de afiliados você está pagando ~US$ Z/mês. Aqui é R$ 197 fixo, sem teto
  e sem taxa. Migro seus afiliados com você numa call."

**2. Comunidades brasileiras de founders (ICP-2):**
- **TabNews** — post técnico: "o que eu descobri construindo atribuição de
  afiliados para SaaS" (a auditoria de 308 contratos é conteúdo raro e verdadeiro).
- **X/Twitter BR de indie hackers** — build in public, mostrando o motor de
  comissão e os casos em que ele **não** paga.
- Grupos de SaaS BR no WhatsApp/Discord/Telegram.
- Comunidades de produtos BR que vendem para fora.

**3. Comunidades globais indie (ICP-3, depois):** Indie Hackers, r/SaaS,
r/microsaas, r/stripe, Product Hunt. Buscar ativamente por quem pergunta
"affiliate program software for my SaaS" e responder com ajuda real, não pitch.

**4. Cold outreach hipersegmentado, 20–30 empresas, manual.** Critérios: usa
Stripe (detectável: `js.stripe.com` no HTML), tem página de afiliados ou parceiros,
é brasileiro **ou** tem founder brasileiro, MRR estimado R$ 10k–150k.

**5. Parceria de distribuição:** quem já fala com SaaS BR que usa Stripe —
consultorias de produto, agências de growth, boilerplates de SaaS brasileiros,
criadores de conteúdo de indie hacking BR. Comissão de indicação usando o próprio
IndicaFluxo (dogfooding que também é prova).

**6. Founder-led onboarding, sem vergonha.** Nos 10 primeiros, faça a integração
**junto com o cliente** em call. Cada call vale mais que uma semana de código: é
onde você descobre por que o `identify` trava.

---

# Validation Plan

Experimento de 30 dias, desenhado para descobrir "existe mercado" ou "ninguém se
importa" no menor tempo possível.

**Funil-alvo:**

```
100 empresas prospectadas (usando Stripe + sinal de afiliados)
 → 40 contatos personalizados
 → 12 respostas
 →  8 conversas de 20 minutos
 →  5 contas criadas
 →  3 integrações completas (tracker + identify + webhook)
 →  1–2 pagantes
```

**Pergunta a responder em cada conversa** (nunca "você gostaria de..."):
1. Você tem programa de afiliados hoje? Se não, por quê?
2. Como você calcula e paga comissão hoje? (mostre a planilha)
3. Quantos afiliados ativos? Quanto de receita eles trouxeram no último mês?
4. Já pagou comissão errada? O que aconteceu?
5. Quanto você paga hoje por isso? (se paga concorrente: qual o plano e o teto?)
6. Se eu te entregar isso pronto amanhã, o que te impediria de usar?

**Sinal de verdade vs sinal falso:** "achei legal" é ruído. Os únicos sinais que
contam: (a) ele **instala o tracker** sem você pedir duas vezes; (b) ele **entra
com cartão**; (c) ele **te apresenta a outro founder**.

**Cronograma para descobrir a verdade: 30 dias.** Se em 30 dias, com 40 contatos
reais, não houver 3 integrações completas, o problema não é a copy.

---

# Metrics

Métricas do funil, com julgamento sobre quais importam de fato.

| Métrica | Alvo inicial | Importância |
| --- | --- | --- |
| Landing → Signup | 2–5% | média (sem tráfego, é vaidade agora) |
| Signup → Programa criado | >70% | média — se cair disso, o formulário de programa está confuso |
| Programa → **Conversão simulada no Sandbox** | >50% | ⭐ **alta** — mede se o aha acontece |
| Signup → **Tracker instalado (1º clique)** | >40% | ⭐⭐ **a mais importante do topo.** Mede se o produto vale um deploy |
| Tracker → **`identify` com `attributionsBound > 0`** | >60% dos que instalaram | ⭐⭐⭐ **a métrica-verdade do produto.** É aqui que a fricção mata |
| `identify` → Stripe conectado (1º evento) | >70% | alta |
| **Primeira comissão live** (ACTIVATION) | >50% dos integrados, em 30 dias | ⭐⭐⭐ define retenção |
| Sandbox → Pagante | >15% | ⭐⭐ a métrica comercial |
| Retenção em 30 dias | >80% | ⭐⭐ |
| **Retenção em 90 dias** | >60% | ⭐⭐⭐ é aqui que "o programa não gerou vendas" aparece |
| Afiliados ativos por cliente (com clique no mês) | >5 | ⭐⭐⭐ **melhor preditor isolado de churn.** Cliente com 1 afiliado ativo vai cancelar |
| Receita atribuída por cliente/mês | > 10× o preço | ⭐⭐⭐ se o cliente gera menos de 10× o que paga, ele cancela em 90 dias |

As três que eu olharia toda semana: **tracker instalado**, **afiliados ativos por
cliente**, **receita atribuída ÷ preço**.

---

# Kill Criteria

Critérios concretos, definidos antes para evitar teimosia emocional:

1. **40 founders do ICP contatados, menos de 6 aceitam conversar** → o problema
   não é prioridade para o segmento. `KILL` ou repensar ICP.
2. **8 conversas, e menos de 3 têm programa de afiliados ou planos concretos de
   ter em 90 dias** → o trigger é raro demais. `PIVOT`.
3. **5 contas criadas, menos de 2 instalam o tracker em 14 dias** → o produto não
   vale um deploy. Isso é morte por fricção. `KILL` ou reconstruir o onboarding
   para não exigir `identify` (via `client_reference_id` do Checkout).
4. **3 integrações completas, nenhuma dispõe-se a pagar R$ 99–149** → não há
   disposição a pagar neste ICP. `KILL` do pricing atual.
5. **Todos os interessados usam Asaas/Iugu/Vindi/Pagar.me e não Stripe** → não é
   kill, é **redirecionamento obrigatório**: o adapter de gateway BR vira o
   roadmap inteiro e o ICP muda para ICP-1.
6. **60 dias, zero pagante, e nenhum dos itens acima explicando o porquê** →
   `STOP`.
7. **Os pagantes iniciais cancelam em até 90 dias porque "o programa não gerou
   vendas"** → o produto funciona e o mercado não sustenta. É o cenário mais
   cruel e o mais provável. Resposta: mudar de "infraestrutura de comissão" para
   "ajudo você a ter afiliados", ou parar.

---

# Pivot Signals

Só recomendados se a validação indicar, não por criatividade:

| Sinal observado | Pivot indicado |
| --- | --- |
| Interessados existem mas cobram por Asaas/Iugu/Vindi/Mercado Pago | **"Afiliados para SaaS brasileiro, no gateway que você já usa"** — adapter Asaas primeiro. Mercado local sem concorrente, mas é reconstruir a camada de billing |
| Founders acham a integração fácil e querem controle fino, reclamam de UI dos concorrentes | **Infraestrutura de referral via API** — vender o motor (track/identify/commission) como API para quem constrói o próprio portal. Mercado menor, ticket maior, suporte menor |
| Founders já usam concorrente e só reclamam de preço/teto | **Ficar exatamente onde está e vender migração** — não é pivot, é foco. Melhor cenário |
| Dor real é "não consigo afiliados", não "não sei calcular" | **Vender aquisição de parceiros**: página pública de programa + diretório/marketplace de afiliados (o que o Reditus faz). Muda o produto e ataca a causa real do churn |
| Ninguém se importa com afiliados, mas todo mundo tem dor com atribuição/webhook do Stripe | **Camada de atribuição e eventos do Stripe** — produto diferente, mesmo núcleo técnico |

**O pivot mais provável de ser necessário é o primeiro (gateway BR).** É também o
mais caro. Por isso a validação deve perguntar o gateway **na primeira mensagem**,
não na call.

---

# Why This May Fail

As melhores objeções, não espantalhos:

1. **O canal de afiliados é secundário para quase todo SaaS pequeno.** A maioria
   nunca passa de 5 afiliados ativos. O produto é excelente para um canal que o
   cliente não prioriza. Você pode ganhar o cliente e perder porque o *canal dele*
   perdeu. Nenhum concorrente resolveu isso — eles sobrevivem porque têm SEO e
   volume de topo de funil. Você não tem nenhum dos dois.
2. **Os incumbentes já resolvem isso bem, e há 6 anos.** Rewardful, FirstPromoter
   e Tapfiliate não têm buraco funcional que justifique um entrante. Os entrantes
   recentes (Tolt, Affonso, Reditus, Push Lap Growth, LinkJolt) já tomaram a
   posição de "mais simples e mais barato". **O IndicaFluxo está chegando terceiro
   numa briga de preço que já foi disputada.**
3. **O onboarding é o pior do mercado.** Exigir chamada de backend obrigatória
   quando todo concorrente resolve com JS + `client_reference_id` é um imposto de
   conversão em cima de quem já tem menos marca. Você pede *mais* esforço e
   oferece *menos* segurança de marca. É a combinação que mais mata trial.
4. **Preço em BRL numa página em inglês não vende para ninguém dos dois lados.**
   E, no Brasil, o SaaS que cobra em BRL usa gateway BR — não Stripe. A interseção
   real do ICP atual é pequena o bastante para caber numa planilha.
5. **Sem taxa e sem teto significa que você não cresce com o cliente.** É o wedge
   e é a armadilha: ARPU fixo, expansão zero, e todo crescimento tem que vir de
   aquisição nova — exatamente a parte que você ainda não provou que consegue.
6. **Custo de suporte por cliente é alto e não escala com founder único.** Cada
   "minha indicação não rastreou" é uma investigação de 30–60 minutos. Com 30
   clientes você tem um trabalho, não um produto passivo.
7. **Preço é o diferencial mais fácil de copiar do mundo.** Se o produto pegar,
   Affonso baixa €15 para €9 numa tarde.
8. **Trigger tardio, raro, e com intenção de busca dominada por concorrentes com
   SEO de anos.** Você não vai ser encontrado. Toda venda será outbound manual —
   ou seja, o canal mais caro em tempo de founder e o menos escalável.
9. **O produto foi construído antes de qualquer conversa com cliente.** 51 mil
   linhas, 4 dias, zero validação. Toda decisão de escopo até aqui foi baseada em
   suposição. A probabilidade de as suposições estarem todas certas é baixa —
   e o custo emocional de mudá-las cresce a cada dia de código bonito.

---

# Why This May Work

Só o que sobreviveu à seção anterior:

1. **A economia contra Tolt e Rewardful é grande demais para ser ignorada por
   quem já paga.** US$ 679/mês (Tolt, 2,9% sobre US$ 20k) contra R$ 197 fixo não
   é margem de negociação, é outro patamar. Para o segmento que **já tem programa
   funcionando**, este argumento fecha venda sozinho — e esse segmento é
   identificável um a um pela internet, hoje, sem SEO.
2. **"Sem taxa, sem teto, para sempre" é uma promessa que o código pode
   sustentar** — não existe percentual em lugar nenhum da base. Isso é raro:
   quase toda promessa de marketing de SaaS é uma intenção; esta é uma
   propriedade estrutural.
3. **O nicho brasileiro que usa Stripe não tem fornecedor local e ninguém
   disputa.** Português nativo, real, nota fiscal brasileira, suporte no mesmo
   fuso, para um público pequeno mas concentrado e alcançável. Wedge estreito é
   como todo micro-SaaS começa.
4. **O núcleo técnico realmente está pronto, e é a parte que leva meses.**
   Idempotência, dupla comissão, reversão proporcional, test/live, RLS. Não é
   vantagem de marketing, mas significa que o tempo agora pode ir 100% para
   distribuição — que é exatamente onde ele precisa ir.
5. **A honestidade é um ativo diferenciável neste nicho específico.** Um produto
   de dinheiro cuja documentação explica os casos em que **você não ganha
   comissão** compra confiança que concorrente nenhum se dá ao trabalho de
   comprar. Em venda founder-a-founder, isso converte.
6. **O Sandbox com conversão simulada dá um caminho de prova sem risco** que
   nenhum concorrente pesquisado oferece com a mesma profundidade. É a peça de
   marketing mais forte do produto e está escondida dentro do app.
7. **Margem bruta >90% e nenhuma exposição financeira regulatória.** Não move
   dinheiro, não guarda cartão, não faz KYC. Um pagante paga a infra inteira.
8. **O custo de descobrir a verdade é baixo: 30 dias e zero código.** Um negócio
   em que o próximo passo certo custa pouco e responde muito é um negócio que
   vale a pena tentar.

---

# Value Scorecard

Notas de 0 a 10 com justificativa individual. **Não tire média** — os problemas
estão em itens específicos e a média os esconderia.

| Dimensão | Nota | Por quê |
| --- | --- | --- |
| **Problem severity** | **6** | Quando dói, dói em dinheiro e em relação com parceiro. Mas dói para poucos e depois de muito tempo. Não é 8 porque a maioria contorna com cupom sem prejuízo percebido |
| **Problem frequency** | **4** | A decisão de compra acontece uma vez, em um momento raro da vida do SaaS. O *uso* é frequente; o *gatilho* não é |
| **Willingness to pay** | **6** | R$ 99–197 é indolor para quem tem o problema, e existe mercado provando que se paga US$ 49–149. Não é mais alto porque o valor percebido depende de um resultado que não é seu |
| **Market size** | **4** | O ICP-2 (BR + Stripe) tem centenas a poucos milhares de empresas. O mercado global é grande mas está ocupado. 4 é o tamanho do mercado **que você pode ganhar**, não do mercado total |
| **Competition intensity** | **2** | 8+ concorrentes diretos, vários mais baratos, todos com marca e SEO. Um até publica "market map com 31 vendors". É das piores notas do scorecard e é factual |
| **Differentiation** | **4** | Preço sem teto/taxa e localidade BR são reais e defensáveis. Mas são de posicionamento, não de produto, e preço se copia. Sem o recorte BR seria 2 |
| **Ease of acquisition** | **3** | Sem domínio, sem SEO, sem prova social, trigger raro, intenção de busca dominada. Toda venda inicial será outbound manual. Salva da nota 2 o fato de os clientes de concorrentes serem **listáveis publicamente** |
| **Time-to-value** | **3** | 1–3 horas e um deploy de backend contra 15 minutos e zero código dos concorrentes. O Sandbox com simulação impede a nota 2 |
| **Retention potential** | **5** | Lock-in técnico real (código, links, portal, histórico recorrente), anulado pelo fato de que o principal motivo de churn — "o programa não vende" — não é atacado por nada |
| **Gross margin potential** | **9** | >90%, sem custo variável relevante, sem movimentação de dinheiro. Só não é 10 porque `/api/track` escala com o sucesso do cliente e não está precificado |
| **Technical defensibility** | **3** | O motor é bom e é caro de reconstruir, mas **não é defensável**: nada impede um concorrente de ter o mesmo. Excelência de execução não é fosso |
| **Founder distribution fit** | **4** | O founder tem acesso natural à comunidade BR de indie hackers e pode vender founder-a-founder, o que é vantagem real. Mas não há audiência construída, nem conteúdo, nem lista. Nota provisória — **é a única do scorecard que depende só de você e pode virar 7 em 60 dias** |
| **Implementation readiness** | **8** | O núcleo está pronto e testado, e é a parte difícil. Perde 2 pontos por: P1 conhecido de comissão silenciosamente perdida, clawback ausente, cobrança nunca testada contra Stripe real |
| **Trust/readiness** | **4** | Tecnicamente confiável (8), comercialmente invisível (1): sem domínio, sem termos, sem contato, sem status, sem cliente. A nota reflete o que o comprador vê, não o que o código faz |

**Leitura honesta:** o scorecard descreve um **produto forte num mercado ruim com
distribuição inexistente**. As notas altas (margem, prontidão) são as que menos
determinam sucesso. As baixas (concorrência, aquisição, time-to-value) são as que
mais determinam. Isso não é veredito de morte — é a definição de "o trabalho
agora é comercial, não técnico".

---

# Risk Scorecard

| Risco | Nível | Por quê |
| --- | --- | --- |
| **Market risk** | 🔴 `HIGH` | O canal de afiliados é secundário para o ICP; o mercado que resta depois de descontar quem não usa Stripe é pequeno |
| **Product risk** | 🟢 `LOW` | O produto faz o que promete, com testes. Riscos são pontuais (P1-1, clawback), não estruturais |
| **Technical risk** | 🟡 `MEDIUM` | Base sólida, mas: cobrança nunca validada contra Stripe real, volume de `/api/track` não testado em escala, dependência única de Stripe |
| **Acquisition risk** | 🔴 `HIGH` | Sem domínio, sem SEO, sem audiência, trigger raro, SERP dominada. **É o maior risco do projeto** |
| **Pricing risk** | 🟡 `MEDIUM` | Nível provavelmente certo; moeda errada para o público em inglês; eixo de upgrade errado (quase ninguém passa de 100 afiliados); expansão zero |
| **Retention risk** | 🔴 `HIGH` | O motivo dominante de churn — "o programa do cliente não gerou vendas" — está fora do controle do produto e não é atacado por nada hoje |
| **Support risk** | 🟡 `MEDIUM` | Categoria naturalmente pesada; mitigada por docs e trilha de auditoria; agravada pela ausência de tela de diagnóstico e pela fricção de integração |
| **Competition risk** | 🔴 `HIGH` | 8+ concorrentes, vários mais baratos, todos com onboarding melhor e marca. O wedge é preço, que se copia em uma tarde |
| **Trust risk** | 🟡 `MEDIUM` | O produto é confiável; a **apresentação** não é. Resolvível em uma semana (domínio, termos, contato, status) — por isso não é `HIGH` |

---

# 30-Day Plan

Sequência prática, adaptada ao diagnóstico: **o gargalo é comercial, então 70% do
tempo vai para fora do editor.**

## Semana 1 — Tornar o produto comprável (não "melhor")

- Registrar `indicafluxo.com` e `indicafluxo.com.br` (ambos livres em 2026-09-17).
- Deploy em produção: domínio, HTTPS, `NEXT_PUBLIC_APP_URL`, Supabase Auth
  (Site URL, Redirect URLs, templates de e-mail em pt-br e en).
- Configurar Stripe real da plataforma e **rodar um ciclo completo de cobrança**
  com cartão de teste e depois um real de R$ 1: checkout → webhook → portal →
  troca de plano → cancelamento.
- Corrigir P1-1 e adicionar o contador **"pagamentos recebidos sem comissão"** na
  tela de Integrações. Sem isso não se cobra por um produto de dinheiro.
- Publicar termos de uso, política de privacidade, página de contato e nome do
  responsável.
- Decidir o ICP e **assumir a consequência na landing**: se for ICP-2, a página
  principal é pt-br, o inglês vira secundário ou some, e a headline muda de
  "infraestrutura de afiliados" para a promessa econômica: *"Programa de afiliados
  para o seu SaaS. Sem taxa sobre a sua receita e sem teto de faturamento —
  R$ 99/mês."*

## Semana 2 — Descobrir se alguém se importa

- Montar lista de **100 empresas**: SaaS com Stripe (`js.stripe.com` no HTML) +
  página de afiliados/parceiros, priorizando BR e founders BR vendendo fora.
- Dentro dela, marcar os que usam **Rewardful/FirstPromoter/Tolt** (portal em
  subdomínio do fornecedor) — é a lista quente.
- **40 mensagens personalizadas**, escritas à mão, uma a uma. Sem automação.
- Agendar e fazer **8 conversas de 20 minutos**, com as 6 perguntas da seção
  *Validation Plan*. Perguntar o **gateway** logo na primeira mensagem.
- Meta da semana: entender se o trigger existe e qual gateway o ICP usa.

## Semana 3 — Reduzir o atrito que as conversas revelarem

- Colocar o **aha antes da integração**: reordenar o onboarding para
  programa → afiliado → **conversão simulada** → depois Stripe/identify.
- Publicar **demo pública** (`/demo`) do pipeline clique → comissão → estorno.
- Snippets de `identify` em Next.js, Express, Rails e Laravel.
- **Integrar 3 clientes ao vivo, em call, com você na chamada.** Cronometre cada
  etapa. Onde eles travarem é o roadmap real — não o que está neste documento.

## Semana 4 — Cobrar

- Pedir dinheiro de quem integrou. Sem desconto vitalício, sem "beta grátis":
  R$ 99 ou R$ 149. **Cobrar é a única pesquisa de mercado que não mente.**
- Testar preço: 5 primeiros a R$ 99, 5 seguintes a R$ 149. Comparar aceitação.
- Instrumentar as 3 métricas-verdade: tracker instalado, `attributionsBound > 0`,
  afiliados ativos por cliente.
- Escrever o post de bastidores (TabNews + X): "construí a infraestrutura de
  afiliados e auditei 308 contratos — o que descobri sobre comissão duplicada no
  Stripe". Conteúdo técnico verdadeiro é o canal orgânico mais barato disponível.
- **Revisar contra os kill criteria e decidir com os números, não com o apego.**

**O que explicitamente NÃO fazer nestes 30 dias:** Paddle, Asaas, pagamento
automático, antifraude, plano Scale, domínio próprio por workspace, webhooks de
saída, redesign. Nenhum desses aumenta a chance do primeiro cliente pagante.

---

# Final Verdict

**`VALIDATE_BEFORE_MORE_DEVELOPMENT`**

Não é `STOP_OR_PIVOT`: o problema é real, o produto funciona, a margem é ótima, o
custo de descobrir a verdade é baixo, e existe um wedge honesto (preço sem teto e
sem taxa + localidade brasileira) que não foi testado uma única vez.

Não é `LAUNCH_NOW`: não há domínio, a cobrança nunca rodou contra Stripe real,
existe um caminho em que a integração parece certa e nunca gera comissão, e não há
termos, contato ou qualquer sinal de que exista alguém do outro lado.

Não é `LAUNCH_AFTER_SMALL_FIXES` porque isso subestima o problema: as correções
são pequenas, mas o que falta não é conserto — é **contato com o mercado**. Zero
conversas com clientes em 51 mil linhas de código é o dado mais importante deste
relatório.

Não é `MAJOR_REPOSITIONING_REQUIRED` **ainda** — mas está a uma descoberta de
distância: se os interessados cobrarem por Asaas/Iugu/Vindi em vez de Stripe, o
reposicionamento passa a ser obrigatório. Descubra isso em duas semanas, não em
três meses.

## Roadmap comercial mínimo

**BEFORE FIRST CUSTOMER** — domínio + deploy · cobrança validada contra Stripe
real · P1-1 corrigido + alerta de "pagamento sem comissão" · termos, privacidade,
contato · landing com um ICP só · 40 contatos enviados.

**BEFORE FIRST PAID CUSTOMER** — aha antes da integração (simulação primeiro) ·
demo pública · snippets por framework · 3 integrações feitas ao vivo em call ·
suporte declarado com tempo de resposta.

**AFTER 10 PAYING CUSTOMERS** — tela de diagnóstico de integração · clawback ·
taxa customizada movida para o Launch · eixo de preço por afiliados ativos ·
e-mails transacionais de ativação · página pública de programa (`/afiliados`) para
o cliente conseguir afiliados.

**AFTER 50 PAYING CUSTOMERS** — segundo gateway (o que os clientes pedirem, não o
que parecer elegante) · domínio próprio / widget embutido · API e webhooks de
saída · Scale · primeira contratação, que deve ser de suporte, não de engenharia.

---

# Fontes

Pesquisa de 2026-09-17. Ver `MARKET_RESEARCH_LIMITATION` na seção *Market*.

- [Rewardful — Pricing](https://www.rewardful.com/pricing)
- [Affiliate Software Pricing 2026: Rewardful vs Tapfiliate vs FirstPromoter vs PartnerStack vs Impact — StackScored](https://www.stackscored.com/pricing/affiliate-software/)
- [Affiliate Software Transaction Fees Compared 2026 — LinkJolt](https://www.linkjolt.io/pricing/compare)
- [Rewardful vs Tolt vs FirstPromoter — Refgrow](https://refgrow.com/compare-competitors/rewardful-vs-tolt-vs-firstpromoter)
- [FirstPromoter — Rewardful vs Tolt](https://firstpromoter.com/compare/rewardful-vs-tolt)
- [Affonso — Pricing](https://affonso.io/pricing)
- [Push Lap Growth — Capterra](https://www.capterra.com/p/10022594/Push-Lap-Growth/)
- [Best Affiliate Software for SaaS in 2026 — Hamster Garage](https://www.hamstergarage.com/article/best-affiliate-software-for-saas)
- [Rewardful — SaaS Affiliate Program Benchmarks](https://www.rewardful.com/articles/saas-affiliate-program-benchmarks)
- [Track360 — Affiliate Software Market Map 2026](https://track360.io/blog/affiliate-software-market-map-2026-vendor-landscape)
- [Gateways de pagamento no Brasil 2026 — Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/)
- [Ferramenta de assinatura para SaaS — Mercado Pago](https://www.mercadopago.com.br/blog/ferramenta-assinatura-saas-alto-faturamento)
- [Cobrança recorrente para SaaS — SystemForge](https://forjadesistemas.com.br/blog/cobranca-recorrente-saas-como-implementar/)

Evidência interna: `PLAN_FEATURE_AUDIT.md`, `LANDING_CLAIMS_AUDIT.md`,
`DOCS_IMPLEMENTATION_AUDIT.md`, `docs/PLANS.md`, `src/lib/plans.ts`,
`src/server/domain/commission.ts`, `src/features/onboarding/activation.ts`,
`pnpm test` (465 passando, 92 puladas), app em `localhost:3000`.
