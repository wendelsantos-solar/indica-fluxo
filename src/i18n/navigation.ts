import { createNavigation } from "next-intl/navigation"

import { routing } from "./routing"

/**
 * Locale-aware replacements for `next/link` and the navigation helpers.
 *
 * Components import these and keep writing canonical hrefs — `/pricing`,
 * `/[workspaceSlug]/commissions` — while the rendered URL becomes `/pt-br/precos`
 * or `/en/pricing`. Importing from `next/link` or `next/navigation` directly
 * inside a localised route drops the prefix and produces a 404.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing)
