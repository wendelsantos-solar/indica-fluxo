"use client"

import type { LucideIcon } from "lucide-react"
import { Command as CommandIcon, Menu, PanelLeft, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Link, usePathname, useRouter } from "@/i18n/navigation"

import { CommandPalette, type Command, type PaletteSearch } from "@/components/layout/command-palette"
import { FocusFrame } from "@/components/layout/focus-frame"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type AppHref = Parameters<ReturnType<typeof useRouter>["push"]>[0]

export interface NavItem {
  key: string
  label: string
  href: AppHref
  /** Canonical, locale-free path used to mark the item active. */
  path: string
  icon: LucideIcon
  /** Second key of the `G` then key chord. Only set for chords that work. */
  chord?: string
}

export interface NavSection {
  key: string
  label?: string
  items: NavItem[]
}

type Shell = {
  openPalette: () => void
  toggleSidebar: () => void
  /**
   * Whether the sidebar is currently an icon rail (768–1023px, or collapsed
   * from 1024px). Labels are hidden then, so controls show their name in a
   * tooltip instead.
   */
  rail: boolean
}
const ShellContext = React.createContext<Shell>({
  openPalette: () => {},
  toggleSidebar: () => {},
  rail: false,
})
export const useShell = () => React.useContext(ShellContext)

const SIDEBAR_KEY = "indica.sidebar.collapsed"
const SIDEBAR_EVENT = "indica:sidebar"

/** The collapsed preference lives in storage; other tabs follow via `storage`. */
function subscribeCollapsed(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(SIDEBAR_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(SIDEBAR_EVENT, onChange)
  }
}

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "true"
  } catch {
    return false
  }
}

const RAIL_QUERY = "(min-width: 768px) and (max-width: 1023.98px)"
const DESKTOP_QUERY = "(min-width: 1024px)"

function subscribeViewport(onChange: () => void) {
  const queries = [window.matchMedia(RAIL_QUERY), window.matchMedia(DESKTOP_QUERY)]
  for (const query of queries) query.addEventListener("change", onChange)
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange)
  }
}

/** "rail" | "desktop" | "phone" — the server renders as a phone, which shows no tooltips. */
function readViewport(): "rail" | "desktop" | "phone" {
  if (window.matchMedia(RAIL_QUERY).matches) return "rail"
  if (window.matchMedia(DESKTOP_QUERY).matches) return "desktop"
  return "phone"
}

/**
 * Label visibility in the sidebar. At ≥1024px labels hide only when the user
 * collapses the sidebar; between 768 and 1024px it is always an icon rail;
 * inside the mobile drawer labels always show.
 */
export const SIDEBAR_LABEL =
  "hidden lg:block lg:group-data-[collapsed=true]/sidebar:hidden group-data-[drawer=true]/sidebar:block"
export const SIDEBAR_CENTER_IN_RAIL =
  "max-lg:justify-center lg:group-data-[collapsed=true]/sidebar:justify-center group-data-[drawer=true]/sidebar:justify-start"
const LABEL = SIDEBAR_LABEL
const CENTER_IN_RAIL = SIDEBAR_CENTER_IN_RAIL

/** A name shown beside a control only while the sidebar is a rail. */
export function RailTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  const { rail } = useShell()
  if (!rail) return children
  return (
    <Tooltip content={label} side="right">
      {children}
    </Tooltip>
  )
}

export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

/**
 * The product frame — DESIGN.md §11. A sidebar on the canvas plane and the
 * page inside one inset, hairline-bordered content panel. Owns the keyboard
 * model: ⌘K palette, `G` then a key to navigate, `[` to collapse.
 */
export function AppShell({
  brand,
  sections,
  footer,
  account,
  environment,
  banner,
  commands,
  search,
  focus = false,
  children,
}: {
  /**
   * Top-left slot: the workspace switcher, or the logo in the affiliate portal.
   * Rendered in the sidebar, the rail and the phone app bar; hide its text in
   * the rail with `SIDEBAR_LABEL`.
   */
  brand: React.ReactNode
  sections: NavSection[]
  /** Nav items pinned to the bottom (settings). */
  footer: NavItem[]
  account: React.ReactNode
  /** Sidebar control above the footer items: the dashboard's Live / Test switch. */
  environment?: React.ReactNode
  /** A strip across the top of the content panel, above every page (test mode). */
  banner?: React.ReactNode
  /** Page-independent actions for the palette, beyond navigation. */
  commands: Command[]
  /** Record lookup for the palette. Without it the trigger says "Comandos", not "Buscar". */
  search?: PaletteSearch
  /**
   * A guided flow (onboarding) that must not invite the reader to wander off:
   * no sidebar, no palette, no `G` chords — the same bare frame as step 1.
   */
  focus?: boolean
  children: React.ReactNode
}) {
  const t = useTranslations("nav")
  const tp = useTranslations("palette")
  const router = useRouter()
  const pathname = usePathname()
  const collapsed = React.useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => false,
  )
  const viewport = React.useSyncExternalStore(subscribeViewport, readViewport, () => "phone" as const)
  const rail = viewport === "rail" || (viewport === "desktop" && collapsed)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [lastPathname, setLastPathname] = React.useState(pathname)

  // Close the drawer on navigation. A render-phase update, not an effect,
  // which would paint the open drawer over the new page for a frame.
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setDrawerOpen(false)
  }

  const toggleSidebar = React.useCallback(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(!readCollapsed()))
    } catch {
      // Storage unavailable (private mode): the toggle simply does not persist.
    }
    window.dispatchEvent(new Event(SIDEBAR_EVENT))
  }, [])

  const allItems = React.useMemo(
    () => [...sections.flatMap((section) => section.items), ...footer],
    [sections, footer],
  )

  const drawerRef = React.useRef<HTMLDivElement>(null)
  const menuButtonRef = React.useRef<HTMLButtonElement>(null)

  // The drawer is modal (DESIGN.md §12): focus moves in, Tab stays inside,
  // Escape closes it, focus returns to the menu button, the page does not scroll.
  React.useEffect(() => {
    if (!drawerOpen) return
    const drawer = drawerRef.current
    const menuButton = menuButtonRef.current
    const focusable = () =>
      [...(drawer?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [])].filter(
        (element) => element.offsetParent !== null,
      )
    focusable()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false)
        return
      }
      if (event.key !== "Tab") return
      const items = focusable()
      const first = items[0]
      const last = items.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener("keydown", onKeyDown)
      menuButton?.focus()
    }
  }, [drawerOpen])

  React.useEffect(() => {
    if (focus) return
    let pendingG = 0
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      // A chord must not fire while the reader types or while a dialog or
      // menu owns the keyboard.
      if (isTypingTarget(event.target)) return
      if (document.querySelector("[role='dialog'][data-state='open'], [aria-modal='true'], [role='menu']")) return
      const key = event.key.toLowerCase()
      if (pendingG && Date.now() - pendingG < 1000) {
        pendingG = 0
        const item = allItems.find((candidate) => candidate.chord === key)
        if (item) {
          event.preventDefault()
          router.push(item.href)
        }
        return
      }
      if (key === "g") pendingG = Date.now()
      else if (key === "[") toggleSidebar()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [allItems, router, toggleSidebar, focus])

  const shell = React.useMemo(
    () => ({ openPalette: () => setPaletteOpen(true), toggleSidebar, rail }),
    [toggleSidebar, rail],
  )

  const paletteCommands = React.useMemo<Command[]>(
    () => [
      ...allItems.map((item) => ({
        id: `nav-${item.key}`,
        group: "navigation" as const,
        label: item.label,
        icon: item.icon,
        keys: item.chord ? ["G", item.chord.toUpperCase()] : undefined,
        run: () => router.push(item.href),
      })),
      ...commands,
      {
        id: "toggle-sidebar",
        group: "actions",
        label: tp("toggleSidebar"),
        icon: PanelLeft,
        keys: ["["],
        run: toggleSidebar,
      },
    ],
    [allItems, commands, router, tp, toggleSidebar],
  )

  const sidebar = (onNavigate?: () => void, onToggle?: () => void) => (
    <SidebarContent
      brand={brand}
      sections={sections}
      footer={footer}
      account={account}
      environment={environment}
      pathname={pathname}
      searchable={Boolean(search)}
      onNavigate={onNavigate}
      onToggle={onToggle}
    />
  )

  if (focus) {
    return (
      <ShellContext.Provider value={shell}>
        <FocusFrame skipLabel={t("skip")}>{children}</FocusFrame>
      </ShellContext.Provider>
    )
  }

  return (
    <ShellContext.Provider value={shell}>
      <div className="min-h-dvh bg-background md:grid md:h-dvh md:grid-cols-[auto_minmax(0,1fr)] md:overflow-hidden">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-skip focus:rounded-control focus:bg-inverse focus:px-3 focus:py-2 focus:text-inverse-foreground"
        >
          {t("skip")}
        </a>

        <aside
          data-collapsed={collapsed}
          className="group/sidebar hidden w-14 transition-[width] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] md:block lg:w-60 lg:data-[collapsed=true]:w-14"
        >
          <div className="flex h-dvh flex-col">{sidebar(undefined, toggleSidebar)}</div>
        </aside>

        {/* Phones: an app bar frames the page and opens the drawer. */}
        <header className="sticky top-0 z-header flex h-12 items-center gap-1 border-b border-border bg-background/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur-[2px] md:hidden">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={t("open")}
            aria-expanded={drawerOpen}
            className="flex size-10 items-center justify-center rounded-control text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <Menu className="size-4.5" aria-hidden="true" />
          </button>
          {/* The brand reads its labels as in the drawer: full name, no rail. */}
          <div data-drawer="true" className="group/sidebar min-w-0 flex-1">
            {brand}
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={search ? t("searchLabel") : t("commandsLabel")}
            className="flex size-10 items-center justify-center rounded-control text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <Search className="size-4.5" aria-hidden="true" />
          </button>
        </header>

        {drawerOpen ? (
          <div className="fixed inset-0 z-drawer md:hidden" role="dialog" aria-modal="true" aria-label={t("navigation")}>
            <button
              type="button"
              aria-label={t("close")}
              tabIndex={-1}
              className="absolute inset-0 animate-[overlay-in_140ms_ease-out] bg-scrim"
              onClick={() => setDrawerOpen(false)}
            />
            <div
              ref={drawerRef}
              data-drawer="true"
              className="group/sidebar absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] animate-fade-in flex-col border-r border-border bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
            >
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label={t("close")}
                className="absolute right-2 top-[calc(env(safe-area-inset-top)+4px)] z-raised flex size-10 items-center justify-center rounded-control text-muted-foreground hover:bg-hover hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
              {sidebar(() => setDrawerOpen(false))}
            </div>
          </div>
        ) : null}

        <main id="main" className="min-w-0 md:h-dvh md:py-2 md:pr-2">
          <div
            id="main-scroll"
            data-slot="scrollable"
            className="relative min-h-[calc(100dvh-3rem)] bg-surface-1 pb-[env(safe-area-inset-bottom)] md:h-full md:min-h-0 md:overflow-y-auto md:rounded-panel md:border md:border-border"
          >
            {banner}
            <div className="px-4 pb-16 md:px-6 [&>*:not([data-page-header])]:mx-auto [&>*:not([data-page-header])]:max-w-content">
              {children}
            </div>
          </div>
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={paletteCommands}
        search={search}
      />
    </ShellContext.Provider>
  )
}

function SidebarContent({
  brand,
  sections,
  footer,
  account,
  environment,
  pathname,
  searchable,
  onNavigate,
  onToggle,
}: {
  brand: React.ReactNode
  sections: NavSection[]
  footer: NavItem[]
  account: React.ReactNode
  environment?: React.ReactNode
  pathname: string
  searchable: boolean
  onNavigate?: () => void
  onToggle?: () => void
}) {
  const t = useTranslations("nav")
  const { openPalette } = useShell()
  const paletteLabel = searchable ? t("searchLabel") : t("commandsLabel")

  return (
    <>
      <div className={cn("flex h-12 items-center gap-1 px-2", CENTER_IN_RAIL)}>
        {/* The brand stays in the rail as a glyph — initials or the logo mark —
            so switching workspace never needs the sidebar expanded. */}
        <div className="min-w-0 flex-1 group-data-[drawer=true]/sidebar:pr-10">{brand}</div>
        {onToggle ? (
          <Tooltip content={<ShortcutHint label={t("collapse")} keys="[" />} side="right">
            <button
              type="button"
              onClick={onToggle}
              aria-label={t("collapse")}
              aria-keyshortcuts="["
              className="hidden size-7 shrink-0 items-center justify-center rounded-control text-faint-foreground transition-colors hover:bg-hover hover:text-foreground lg:inline-flex lg:group-data-[collapsed=true]/sidebar:hidden"
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
      </div>

      <div className="px-2 pb-2">
        <RailTooltip label={paletteLabel}>
          <button
            type="button"
            onClick={() => {
              onNavigate?.()
              openPalette()
            }}
            aria-label={paletteLabel}
            aria-keyshortcuts="Meta+K Control+K"
            className={cn(
              "flex h-8 w-full items-center gap-2.5 rounded-control border border-border bg-fill-subtle px-2 text-caption text-faint-foreground",
              "transition-colors hover:border-border-strong hover:text-muted-foreground touch:h-10",
              CENTER_IN_RAIL,
            )}
          >
            {searchable ? (
              <Search className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <CommandIcon className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className={cn(LABEL, "flex-1 text-left")}>
              {searchable ? t("search") : t("commands")}
            </span>
            <Kbd className={cn(LABEL, "group-data-[drawer=true]/sidebar:hidden")}>
              <ModKey />K
            </Kbd>
          </button>
        </RailTooltip>
      </div>

      <nav aria-label={t("main")} className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 pt-2">
        {sections.map((section) => (
          <div key={section.key} className="flex flex-col gap-px">
            {section.label ? (
              <p className={cn(LABEL, "px-2 pb-1 text-meta text-faint-foreground")}>{section.label}</p>
            ) : null}
            {section.items.map((item) => (
              <NavLink key={item.key} item={item} pathname={pathname} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-px border-t border-border-faint px-2 py-2">
        {onToggle ? (
          <Tooltip content={<ShortcutHint label={t("expand")} keys="[" />} side="right">
            <button
              type="button"
              onClick={onToggle}
              aria-label={t("expand")}
              aria-keyshortcuts="["
              className="hidden h-8 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-hover hover:text-foreground lg:group-data-[collapsed=true]/sidebar:flex"
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
        {environment}
        {footer.map((item) => (
          <NavLink key={item.key} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
        {account}
      </div>
    </>
  )
}

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem
  pathname: string
  onNavigate?: () => void
}) {
  const active = pathname === item.path || pathname.startsWith(`${item.path}/`)
  const Icon = item.icon
  return (
    <RailTooltip label={item.label}>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 items-center gap-2.5 rounded-control px-2 text-caption font-medium transition-colors duration-[120ms] touch:h-10",
          CENTER_IN_RAIL,
          active
            ? "bg-selected text-foreground"
            : "text-muted-foreground hover:bg-hover hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span className={cn(LABEL, "flex-1 truncate")}>{item.label}</span>
      </Link>
    </RailTooltip>
  )
}

/** An icon-only control's name plus the key that does the same thing. */
function ShortcutHint({ label, keys }: { label: string; keys: string }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      <Kbd>{keys}</Kbd>
    </span>
  )
}

const subscribeNothing = () => () => {}

/** ⌘ on Apple platforms, Ctrl elsewhere — the hint must match the shortcut. */
export function ModKey() {
  const apple = React.useSyncExternalStore(
    subscribeNothing,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => true,
  )
  return <>{apple ? "⌘" : "Ctrl "}</>
}
