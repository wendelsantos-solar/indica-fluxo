import { notFound } from "next/navigation"

/**
 * Any path no route claims lands here, so `notFound()` renders the localised
 * `[locale]/not-found.tsx` instead of Next's unstyled English default.
 */
export default function CatchAllPage() {
  notFound()
}
