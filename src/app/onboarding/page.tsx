import type { Metadata } from "next"

import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { CreateWorkspaceForm } from "@/features/workspaces/create-workspace-form"
import { requireUser } from "@/server/auth/session"

export const metadata: Metadata = { title: "Create your workspace" }
export const dynamic = "force-dynamic"

export default async function OnboardingPage() {
  await requireUser()

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-4">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-[460px] flex-1 flex-col justify-center px-4 py-10">
        <div className="mb-6 space-y-2">
          <p className="text-[12px] font-medium uppercase tracking-[0.02em] text-muted-foreground">
            Step 1 of 2
          </p>
          <h1 className="text-[26px] font-medium tracking-[-0.02em]">Create your workspace</h1>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            A workspace holds your programs, affiliates and commission ledger. You can rename it
            later; the currency sets the default for new programs.
          </p>
        </div>

        <CreateWorkspaceForm />
      </main>
    </div>
  )
}
