import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { Logo } from "@/components/layout/logo"

const LINK = "text-caption text-muted-foreground transition-colors duration-[120ms] hover:text-foreground"

/**
 * Only routes that exist. Legal pages are not written yet, so they are not
 * linked — a footer full of dead links is worse than a short one.
 */
export async function SiteFooter() {
  const t = await getTranslations("marketing")

  // Nav and footer use the same names for the same destinations.
  const groups = [
    {
      title: t("footer.explore"),
      links: [
        { href: { pathname: "/" as const, hash: "produto" }, label: t("chrome.product") },
        { href: { pathname: "/" as const, hash: "como-funciona" }, label: t("chrome.howItWorks") },
        { href: { pathname: "/" as const, hash: "integracoes" }, label: t("footer.integrations") },
        { href: "/pricing" as const, label: t("chrome.pricing") },
        { href: "/docs" as const, label: t("chrome.docs") },
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
      <div className="mx-auto grid w-full max-w-page gap-10 px-4 py-14 sm:px-6 md:grid-cols-[2fr_repeat(2,1fr)]">
        <div className="max-w-xs space-y-3">
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
        <p className="mx-auto w-full max-w-page px-4 py-5 text-meta text-faint-foreground sm:px-6">
          {t("footer.rights", { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  )
}
