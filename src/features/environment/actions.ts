"use server"

import { cookies } from "next/headers"
import { z } from "zod"

import { VIEW_ENVIRONMENT_MAX_AGE_SECONDS, VIEW_ENVIRONMENTS, viewEnvironmentCookie } from "@/lib/view-environment"
import { requireUser } from "@/server/auth/session"
import { getWorkspaceForUser } from "@/server/services/workspaces"

const schema = z.object({
  workspaceSlug: z.string().min(1).max(100),
  environment: z.enum(VIEW_ENVIRONMENTS),
})

/**
 * The shell's Live / Test switch. Stores the choice for this workspace in this
 * browser; the next render resolves it against the plan
 * (`getViewEnvironment`), so asking for Live on Sandbox still shows Test.
 * Returns whether the choice was stored; the caller refreshes the route.
 */
export async function setViewEnvironmentAction(input: {
  workspaceSlug: string
  environment: string
}): Promise<{ ok: boolean }> {
  const user = await requireUser()
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false }

  try {
    // Membership first: a cookie is only ever named after a workspace the reader belongs to.
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    const store = await cookies()
    store.set(viewEnvironmentCookie(workspace.id), parsed.data.environment, {
      path: "/",
      maxAge: VIEW_ENVIRONMENT_MAX_AGE_SECONDS,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
