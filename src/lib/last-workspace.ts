/**
 * The workspace a founder last opened, remembered per browser so "Voltar ao
 * painel" returns there instead of to whichever workspace sorts first. A
 * preference, not an authorisation: the slug is always checked against the
 * reader's own memberships before it is used.
 */
export const LAST_WORKSPACE_COOKIE = "indica_last_workspace"
export const LAST_WORKSPACE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/** The remembered workspace when the reader still belongs to it, else the first one. */
export function pickReturnWorkspace<T extends { slug: string }>(
  workspaces: readonly T[],
  rememberedSlug: string | null | undefined,
): T | null {
  return workspaces.find((workspace) => workspace.slug === rememberedSlug) ?? workspaces[0] ?? null
}
