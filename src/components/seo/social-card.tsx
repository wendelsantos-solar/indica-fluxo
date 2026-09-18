import { ImageResponse } from "next/og"

import { BRAND } from "@/lib/brand"

export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 }

/*
 * The social card is rendered to a PNG by Satori, which cannot read CSS custom
 * properties — so this is the one place hex values stand in for tokens. They
 * are the dark theme's own: void canvas, carbon panel, graphite hairline,
 * snow/fog text and the primary ink (src/design/tokens.css).
 */
const VOID = "#08090a"
const CARBON = "#0f1011"
const GRAPHITE = "#23252a"
const SNOW = "#f7f8f8"
const FOG = "#8a8f98"
const PRIMARY = SNOW

/**
 * One card for every public page: the brand, the page's category line and its
 * headline, and one line of facts. Text only — no screenshot, which would be
 * illegible at the size a feed shows it.
 */
export function socialCard({ eyebrow, headline, footer }: { eyebrow: string; headline: string; footer: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: VOID,
          padding: 72,
          color: SNOW,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontWeight: 600 }}>
          <div style={{ width: 28, height: 6, borderRadius: 3, background: PRIMARY }} />
          {BRAND.name}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 26, color: FOG }}>{eyebrow}</div>
          <div style={{ fontSize: 68, lineHeight: 1.05, letterSpacing: -2, maxWidth: 960 }}>{headline}</div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            fontSize: 24,
            color: FOG,
            borderTop: `1px solid ${GRAPHITE}`,
            paddingTop: 28,
            background: CARBON,
            marginLeft: -72,
            marginRight: -72,
            paddingLeft: 72,
            marginBottom: -72,
            paddingBottom: 48,
          }}
        >
          {footer}
        </div>
      </div>
    ),
    SOCIAL_CARD_SIZE,
  )
}
