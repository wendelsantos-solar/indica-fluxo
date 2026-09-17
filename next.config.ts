import createNextIntlPlugin from "next-intl/plugin"
import type { NextConfig } from "next"

const isDev = process.env.NODE_ENV === "development"

/**
 * Security headers. The CSP is deliberately strict on everything except the
 * tracker route, which is a public asset by design.
 *
 * `'unsafe-inline'` on script-src is required by the Next.js App Router's
 * inline bootstrap and by next-themes' anti-flash script; it is paired with a
 * closed default-src and a frame-ancestors lock so the residual risk is small.
 *
 * `'unsafe-eval'` is added in development only: React's dev build and the
 * Turbopack HMR runtime use eval() for source mapping and module evaluation.
 * It must never reach a production response — production React never evals.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co${
        isDev ? " ws://localhost:* http://localhost:*" : ""
      }`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Every dashboard page is dynamic, and by default the client router keeps
    // none of them: going back to a page seen a moment ago re-runs all of its
    // queries. 30 s makes that instant. Mutations still show at once — Server
    // Actions here call `revalidatePath`, set a cookie or `router.refresh()`,
    // each of which clears this cache. Only changes made elsewhere (a webhook)
    // can appear up to 30 s late on a back-navigation.
    staleTimes: { dynamic: 30 },
  },

  // The dev server is also reached through a tunnel on this host. Without it,
  // Next blocks cross-origin requests to dev-only assets (HMR, `/_next/*`).
  allowedDevOrigins: ["fazproposta.wendelpaco.dev"],

  async headers() {
    return [
      {
        source: "/((?!t\\.js).*)",
        headers: securityHeaders,
      },
      {
        // The tracker is meant to be embedded on customer domains.
        source: "/t.js",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ]
  },
}

/**
 * The plugin points next-intl at `src/i18n/request.ts`, which resolves the
 * locale and loads its catalogue for every server render.
 */
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

export default withNextIntl(nextConfig)
