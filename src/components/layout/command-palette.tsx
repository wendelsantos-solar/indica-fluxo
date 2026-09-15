"use client"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import type { LucideIcon } from "lucide-react"
import { Search } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"

export type CommandGroup =
  | "programs"
  | "affiliates"
  | "batches"
  | "navigation"
  | "actions"
  | "workspaces"

export interface Command {
  id: string
  group: CommandGroup
  label: string
  detail?: string
  icon: LucideIcon
  /** Shown as key hints. Only for shortcuts that actually work. */
  keys?: string[]
  /** Extra words to match, e.g. both locales' spelling of a page. */
  keywords?: string
  run: () => void
}

/** Records the reader searched for come first; then pages, actions, workspaces. */
const ORDER: CommandGroup[] = ["programs", "affiliates", "batches", "navigation", "actions", "workspaces"]

/** Remote results are fetched once the reader pauses, and only for real queries. */
const SEARCH_DELAY_MS = 200
export const SEARCH_MIN_LENGTH = 2

/**
 * Looks up records for a query. Resolves to commands already matched on the
 * server — they skip the local filter. May reject; the palette then keeps
 * showing its local commands.
 */
export type PaletteSearch = (query: string) => Promise<Command[]>

/**
 * ⌘K — DESIGN.md §9. A combobox over grouped commands: the input keeps focus,
 * arrows move `aria-activedescendant`, Enter runs, Escape closes and returns
 * focus to whatever opened it (Radix handles the trap and the return).
 */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
  search,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: Command[]
  search?: PaletteSearch
}) {
  const t = useTranslations("palette")

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-modal animate-[overlay-in_140ms_ease-out] bg-scrim" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-[max(12px,env(safe-area-inset-top))] z-modal w-[min(640px,calc(100vw-24px))] -translate-x-1/2",
            "overflow-hidden rounded-panel bg-surface-3 shadow-overlay outline-none sm:top-[12vh]",
            "data-[state=open]:animate-pop-in",
          )}
        >
          <DialogPrimitive.Title className="sr-only">{t("dialog")}</DialogPrimitive.Title>
          {open ? (
            <PaletteBody commands={commands} search={search} onClose={() => onOpenChange(false)} />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function PaletteBody({
  commands,
  search,
  onClose,
}: {
  commands: Command[]
  search?: PaletteSearch
  onClose: () => void
}) {
  const t = useTranslations("palette")
  const ta = useTranslations("common.actions")
  const id = React.useId()
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(0)
  // Results are keyed by the query they answer, so a slow response for an
  // older query can never be shown under a newer one.
  const [remote, setRemote] = React.useState<{ query: string; commands: Command[] } | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const needle = query.trim()
  const searching = Boolean(search) && needle.length >= SEARCH_MIN_LENGTH

  React.useEffect(() => {
    if (!search || needle.length < SEARCH_MIN_LENGTH) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      search(needle)
        .then((found) => {
          if (!cancelled) setRemote({ query: needle, commands: found })
        })
        .catch(() => {
          if (!cancelled) setRemote({ query: needle, commands: [] })
        })
    }, SEARCH_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [search, needle])

  const remoteCommands = searching && remote?.query === needle ? remote.commands : []
  const loading = searching && remote?.query !== needle

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands
      .map((command) => {
        const label = command.label.toLowerCase()
        const haystack = `${label} ${command.keywords ?? ""} ${command.detail ?? ""}`.toLowerCase()
        const rank = label.startsWith(needle) ? 0 : label.includes(needle) ? 1 : haystack.includes(needle) ? 2 : -1
        return { command, rank }
      })
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.command)
  }, [commands, query])

  // Grouped for display; arrow keys follow the flattened visual order.
  const all = [...remoteCommands, ...filtered]
  const groups = ORDER.map((group) => ({
    group,
    items: all.filter((command) => command.group === group),
  })).filter((entry) => entry.items.length > 0)
  const flat = groups.flatMap((entry) => entry.items)
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1))

  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  function run(command: Command | undefined) {
    if (!command) return
    onClose()
    command.run()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((activeIndex + 1) % Math.max(1, flat.length))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((activeIndex - 1 + flat.length) % Math.max(1, flat.length))
    } else if (event.key === "Enter") {
      event.preventDefault()
      run(flat[activeIndex])
    }
  }

  let index = -1
  return (
    <>
      <div className="flex h-12 items-center gap-3 border-b border-border px-4">
        <Search className="size-4 shrink-0 text-faint-foreground" aria-hidden="true" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={flat[activeIndex] ? `${id}-${flat[activeIndex].id}` : undefined}
          aria-autocomplete="list"
          aria-label={t("searchLabel")}
          placeholder={t("placeholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-faint-foreground sm:text-ui"
        />
        <DialogPrimitive.Close className="shrink-0" aria-label={ta("closeDialog")}>
          <Kbd>Esc</Kbd>
        </DialogPrimitive.Close>
      </div>

      <div
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        aria-label={t("list")}
        data-slot="scrollable"
        className="max-h-[min(400px,65dvh)] overflow-y-auto overflow-x-hidden p-1.5"
      >
        {flat.length === 0 ? (
          <p className="px-3 py-8 text-center text-caption text-muted-foreground">
            {loading ? t("searching") : t("noMatch", { query })}
          </p>
        ) : (
          groups.map((entry) => (
            <div key={entry.group} role="group" aria-label={t(`groups.${entry.group}`)} className="pb-1">
              <p aria-hidden="true" className="px-2.5 pb-1 pt-2 text-meta text-faint-foreground">
                {t(`groups.${entry.group}`)}
              </p>
              {entry.items.map((command) => {
                index++
                const itemIndex = index
                const current = itemIndex === activeIndex
                const Icon = command.icon
                return (
                  <div
                    key={command.id}
                    id={`${id}-${command.id}`}
                    role="option"
                    aria-selected={current}
                    data-index={itemIndex}
                    onMouseMove={() => setActive(itemIndex)}
                    onClick={() => run(command)}
                    className={cn(
                      "flex h-10 items-center gap-2.5 rounded-control px-2.5 text-caption sm:h-9",
                      current ? "bg-selected text-foreground" : "text-foreground-secondary",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{command.label}</span>
                    {command.detail ? (
                      <span className="truncate text-meta text-faint-foreground">{command.detail}</span>
                    ) : null}
                    {command.keys ? (
                      <span className="ml-auto hidden gap-1 sm:flex">
                        {command.keys.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))
        )}
        {loading && flat.length > 0 ? (
          <p aria-hidden="true" className="px-2.5 pb-1 pt-2 text-meta text-faint-foreground">
            {t("searching")}
          </p>
        ) : null}
      </div>

      <p aria-live="polite" className="sr-only">
        {loading ? t("searching") : searching ? t("resultCount", { count: flat.length }) : ""}
      </p>

      <div className="hidden h-9 items-center gap-4 border-t border-border px-4 text-meta text-faint-foreground sm:flex">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          {t("toNavigate")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          {t("toOpen")}
        </span>
      </div>
    </>
  )
}
