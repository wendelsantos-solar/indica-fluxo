import Link from "next/link"

import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Logo } from "@/components/layout/logo"

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2" aria-label="Indica home">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
      <footer className="px-6 py-6 text-center text-meta text-muted-foreground">
        Referral infrastructure for SaaS.
      </footer>
    </div>
  )
}
