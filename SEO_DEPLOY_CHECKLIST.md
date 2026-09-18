# SEO_DEPLOY_CHECKLIST.md

O que fazer para o site ser indexado — e o que **não** fazer antes do domínio
final. Data: 2026-09-18.

> **Atualização (rebrand):** marca **Refvia**, domínio pretendido
> `https://refvia.com.br` (site e app no mesmo host, apex canônico, `www` → 301).
> A ordem completa de deploy está em `VERCEL_DEPLOY_CHECKLIST.md`; esta página
> continua valendo para a parte de SEO. Em Preview/Development da Vercel e em
> hosts `*.vercel.app`/localhost a indexação fica desligada mesmo com
> `SITE_INDEXING=on`.

---

## 0. Estado padrão: indexação desligada

Todo build sem `SITE_INDEXING=on` sai com:
- `robots.txt` → `Disallow: /`, sem sitemap;
- `sitemap.xml` vazio;
- `<meta name="robots" content="noindex">` em todas as páginas.

**Motivo:** enquanto o domínio definitivo não estiver no ar, o host é provisório. Indexar
um domínio que vai mudar gasta a pouca autoridade de um site novo em URLs que
depois viram redirect. Ligue só no domínio definitivo.

## 1. Quando o domínio final for decidido

1. **Marca** (se mudar): `src/lib/brand.ts` → `name`. Nada mais no código.
   Ao preencher `social.x`/`linkedin`/`github` e `supportEmail`, eles passam a
   aparecer em `twitter:site` e no JSON-LD `Organization` automaticamente.
   **Não** renomear `ifx_`, `indicafluxo_ref` nem cookies do tracker.
2. **Variáveis** no provedor de deploy (produção apenas):
   ```
   NEXT_PUBLIC_SITE_URL=https://refvia.com.br   # origem pública, sem barra final
   NEXT_PUBLIC_APP_URL=https://refvia.com.br    # mesmo host no primeiro deploy
   SITE_INDEXING=on
   ```
   Previews/staging: **não** definir `SITE_INDEXING`.
3. **Stripe OAuth / webhooks / Supabase:** se `NEXT_PUBLIC_APP_URL` mudar,
   atualizar redirect URIs do Stripe Connect, endpoints de webhook no Stripe
   (`<APP_URL>/api/webhooks/stripe/...`, `<APP_URL>/api/platform-billing/stripe/webhook`)
   e as Redirect URLs de Auth no Supabase.
4. **Migration:** `pnpm db:migrate` (inclui `0017_workspace_acquisition`)
   **antes** do deploy do código — a criação de workspace grava a coluna nova.
5. **Build** (as flags são lidas no build — páginas são estáticas).
6. **Redirects do host antigo:** se o host provisório receber tráfego, 301 de
   cada URL para a mesma URL no domínio novo (no proxy/DNS/CDN), nunca tudo
   para a home.
7. **HTTPS** obrigatório; `www` vs apex: escolher um e redirecionar o outro
   (301) — o escolhido é o `NEXT_PUBLIC_SITE_URL`.

## 2. Verificar antes de anunciar

```bash
BASE_URL=https://www.DOMINIO pnpm seo:check
```

Deve terminar em `All N checks passed`. Verifica: 200 em todas as URLs do
sitemap, `lang`, title ≤ 70, description ≤ 160, `robots=index`, canonical
absoluto e autorreferente (inclusive com UTM na URL), hreflang = sitemap, 1 H1,
Open Graph + Twitter card, JSON-LD válido sem rating; login/cadastro
`noindex`; dashboard/portal/`/app`/onboarding/caminho inexistente → redirect
para login; `X-Robots-Tag: noindex` em `/api/*`.

Manual, uma vez:
- [Rich Results Test](https://search.google.com/test/rich-results) na home e
  numa página SEO (Organization, SoftwareApplication, BreadcrumbList);
- [Schema validator](https://validator.schema.org/);
- compartilhar uma URL no LinkedIn/X (Post Inspector / Card Validator) para
  ver o card 1200×630.

## 3. Google Search Console

1. **Propriedade de domínio** (`Domain` property: `DOMINIO`) — cobre http/https,
   www/apex e subdomínios. Verificação por **registro DNS TXT** no provedor de
   DNS. (Não usar meta tag: exigiria mudar código a cada verificação.)
2. Opcional: propriedades de prefixo de URL para `https://www.DOMINIO/pt-br/` e
   `https://www.DOMINIO/en/`, para ler desempenho por idioma separado.
3. **Sitemaps** → enviar `https://www.DOMINIO/sitemap.xml`.
4. **Inspeção de URL** → solicitar indexação de: home PT, home EN e as 6 páginas
   SEO.
5. Acompanhar em 2–4 semanas:
   - Páginas → "Excluída pela tag noindex" deve conter só login/cadastro etc.;
   - "Cópia sem página canônica selecionada pelo usuário" deve ser zero;
   - Internacional/hreflang sem erros de "sem tags de retorno";
   - Desempenho → consultas por página (canibalização home × guia: ver
     SEO_CONTENT_MAP.md);
   - Core Web Vitals (dados de campo, quando houver volume).
6. Não usar a ferramenta de remoção para "limpar" o host antigo — use 301.

## 4. Bing Webmaster Tools

Relevante para o mercado internacional (Bing alimenta também DuckDuckGo,
Yahoo, Ecosia e respostas de assistentes de IA).

1. Entrar em bing.com/webmasters → **Importar do Google Search Console**
   (herda propriedade e sitemap) — ou adicionar o site e verificar por DNS
   (CNAME) ou arquivo XML.
2. Enviar `https://www.DOMINIO/sitemap.xml`.
3. **IndexNow:** opcional e depois. Exige uma chave pública num arquivo servido
   na raiz e um ping a cada publicação; com 12 URLs que mudam raramente, o
   sitemap basta.
4. URL Inspection nas páginas SEO EN.

## 5. Depois de indexado

- Rodar `pnpm seo:funnel` mensalmente (canal × landing → workspace, programa,
  sandbox, tracker, 1ª comissão, pago).
- Ao alterar a copy de uma página: atualizar `updated` em `src/lib/seo/pages.ts`
  (vira `lastmod` no sitemap). Não alterar a data sem mudar conteúdo.
- Páginas de comparação: nunca publicar sem `verifiedOn`; revisar a cada 120
  dias (o teste falha).
- Publicar Termos e Política de privacidade (SEO_AUDIT.md A14) e linkar no
  footer — pré-requisito de confiança e de LGPD com o cookie `_acq`.
