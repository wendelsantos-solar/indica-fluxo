import { serializeJsonLd } from "@/lib/seo/structured-data"

/** Renders structured data into the server HTML, where crawlers read it without running JS. */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />
}
