import { CONNECTORS, isConnectorId } from "@/lib/billing/catalog"
import { cn } from "@/lib/utils"

/**
 * A provider's mark: a neutral monogram tile beside its name. Not the
 * provider's logo — using official marks needs each brand's guidelines, which
 * this product has not cleared — so no variant of anyone's logo is invented
 * (brief §36). The name, not the tile, carries the identity.
 */
export function ProviderMark({ provider, className }: { provider: string; className?: string }) {
  const name = isConnectorId(provider) ? CONNECTORS[provider].name : provider
  const letters = name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-control border border-border bg-fill-subtle",
        "text-meta font-medium text-foreground-secondary",
        className,
      )}
    >
      {letters}
    </span>
  )
}

export function providerName(provider: string): string {
  return isConnectorId(provider) ? CONNECTORS[provider].name : provider
}
