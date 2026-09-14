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

export default nextConfig
