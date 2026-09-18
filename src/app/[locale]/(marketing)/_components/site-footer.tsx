import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { LegalLinks } from "@/components/layout/legal-links"
import { Logo } from "@/components/layout/logo"

const LINK = "text-caption text-muted-foreground transition-colors duration-[120ms] hover:text-foreground"

/**
 * Only routes that exist. The legal pages sit in the bottom row, next to the
 * copyright, not as a fourth column: a short footer, not a sitemap. "Resources"
 * carries the search-intent pages once each: a few real links, not a link farm.
 */
export async function SiteFooter() {
  const t = await getTranslations("marketing")
  const seo = await getTranslations("seo")

  // Nav and footer use the same names for the same destinations.
  const groups = [
    {
      title: t("footer.product"),
      links: [
        { href: { pathname: "/" as const, hash: "produto" }, label: t("chrome.product") },
        { href: { pathname: "/" as const, hash: "como-funciona" }, label: t("chrome.howItWorks") },
        { href: { pathname: "/" as const, hash: "integracoes" }, label: t("footer.integrations") },
        { href: "/pricing" as const, label: t("chrome.pricing") },
      ],
    },
    {
      title: t("footer.resources"),
      links: [
        { href: "/docs" as const, label: t("chrome.docs") },
        { href: "/saas-affiliate-program" as const, label: seo("links.saasAffiliateProgram.title") },
        { href: "/affiliate-software" as const, label: seo("links.affiliateSoftware.title") },
        { href: "/stripe-affiliates" as const, label: seo("links.stripeAffiliates.title") },
      ],
    },
    {
      title: t("footer.account"),
      links: [
        { href: "/login" as const, label: t("chrome.signIn") },
        { href: "/signup" as const, label: t("footer.createAccount") },
      ],
    },
  ]

  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid w-full max-w-page gap-10 px-4 py-14 sm:px-6 sm:grid-cols-3 md:grid-cols-[2fr_repeat(3,1fr)]">
        <div className="max-w-xs space-y-3 sm:col-span-3 md:col-span-1">
          <Logo />
          <p className="text-pretty text-caption text-muted-foreground">{t("chrome.footer")}</p>
        </div>
        {groups.map((group) => (
          <div key={group.title}>
            <p className="text-caption font-medium text-foreground">{group.title}</p>
            <ul className="mt-3 space-y-2.5">
              {group.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className={LINK}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border-faint">
        <div className="mx-auto flex w-full max-w-page flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-5 text-meta text-faint-foreground sm:px-6">
          <p>{t("footer.rights", { year: new Date().getFullYear() })}</p>
          <LegalLinks />
        </div>
      </div>
    </footer>
  )
}
