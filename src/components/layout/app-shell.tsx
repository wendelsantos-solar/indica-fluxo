"use client"

import type { LucideIcon } from "lucide-react"
import { Menu, PanelLeft, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Link, usePathname, useRouter } from "@/i18n/navigation"

import { CommandPalette, type Command } from "@/components/layout/command-palette"
import { Kbd } from "@/components/ui/kbd"
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

type Shell = { openPalette: () => void; toggleSidebar: () => void }
const ShellContext = React.createContext<Shell>({ openPalette: () => {}, toggleSidebar: () => {} })
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

/**
 * Label visibility in the sidebar. At ≥1024px labels hide only when the user
 * collapses the sidebar; between 768 and 1024px it is always an icon rail;
 * inside the mobile drawer labels always show.
 */
const LABEL =
  "hidden lg:block lg:group-data-[collapsed=true]/sidebar:hidden group-data-[drawer=true]/sidebar:block"
const CENTER_IN_RAIL =
  "max-lg:justify-center lg:group-data-[collapsed=true]/sidebar:justify-center group-data-[drawer=true]/sidebar:justify-start"

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
  commands,
  children,
}: {
  /** Top-left slot: the workspace switcher, or the logo in the affiliate portal. */
  brand: React.ReactNode
  sections: NavSection[]
  /** Nav items pinned to the bottom (settings). */
  footer: NavItem[]
  account: React.ReactNode
  /** Page-independent actions for the palette, beyond navigation. */
  commands: Command[]
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
  }, [allItems, router, toggleSidebar])

  const shell = React.useMemo(
    () => ({ openPalette: () => setPaletteOpen(true), toggleSidebar }),
    [toggleSidebar],
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
      pathname={pathname}
      onNavigate={onNavigate}
      onToggle={onToggle}
    />
  )

  return (
    <ShellContext.Provider value={shell}>
      <div className="min-h-dvh bg-background md:grid md:h-dvh md:grid-cols-[auto_minmax(0,1fr)] md:overflow-hidden">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-control focus:bg-inverse focus:px-3 focus:py-2 focus:text-inverse-foreground"
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
        <header className="sticky top-0 z-30 flex h-12 items-center gap-1 border-b border-border bg-background/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur-[2px] md:hidden">
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
          <div className="min-w-0 flex-1">{brand}</div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={t("searchLabel")}
            className="flex size-10 items-center justify-center rounded-control text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <Search className="size-4.5" aria-hidden="true" />
          </button>
        </header>

        {drawerOpen ? (
          <div className="fixed inset-0 z-[90] md:hidden" role="dialog" aria-modal="true" aria-label={t("navigation")}>
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
                className="absolute right-2 top-[calc(env(safe-area-inset-top)+4px)] z-10 flex size-10 items-center justify-center rounded-control text-muted-foreground hover:bg-hover hover:text-foreground"
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
            <div className="px-4 pb-16 md:px-6 [&>*:not([data-page-header])]:mx-auto [&>*:not([data-page-header])]:max-w-content">
              {children}
            </div>
          </div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={paletteCommands} />
    </ShellContext.Provider>
  )
}

function SidebarContent({
  brand,
  sections,
  footer,
  account,
  pathname,
  onNavigate,
  onToggle,
}: {
  brand: React.ReactNode
  sections: NavSection[]
  footer: NavItem[]
  account: React.ReactNode
  pathname: string
  onNavigate?: () => void
  onToggle?: () => void
}) {
  const t = useTranslations("nav")
  const { openPalette } = useShell()

  return (
    <>
      <div className={cn("flex h-12 items-center gap-1 px-2", CENTER_IN_RAIL)}>
        <div
          className={cn(
            "min-w-0 flex-1 group-data-[drawer=true]/sidebar:pr-10",
            onToggle && "lg:group-data-[collapsed=true]/sidebar:hidden",
          )}
        >
          {brand}
        </div>
        {onToggle ? (
          <>
            <button
              type="button"
              onClick={onToggle}
              aria-label={t("collapse")}
              title={`${t("collapse")}  [`}
              className="hidden size-7 shrink-0 items-center justify-center rounded-control text-faint-foreground transition-colors hover:bg-hover hover:text-foreground lg:inline-flex lg:group-data-[collapsed=true]/sidebar:hidden"
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onToggle}
              aria-label={t("expand")}
              title={`${t("expand")}  [`}
              className="hidden size-8 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-hover hover:text-foreground lg:group-data-[collapsed=true]/sidebar:inline-flex"
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>

      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={() => {
            onNavigate?.()
            openPalette()
          }}
          title={t("searchLabel")}
          aria-label={t("searchLabel")}
          className={cn(
            "flex h-8 w-full items-center gap-2.5 rounded-control border border-border bg-fill-subtle px-2 text-caption text-faint-foreground",
            "transition-colors hover:border-border-strong hover:text-muted-foreground touch:h-10",
            CENTER_IN_RAIL,
          )}
        >
          <Search className="size-3.5 shrink-0" aria-hidden="true" />
          <span className={cn(LABEL, "flex-1 text-left")}>{t("search")}</span>
          <Kbd className={cn(LABEL, "group-data-[drawer=true]/sidebar:hidden")}>
            <ModKey />K
          </Kbd>
        </button>
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
    <Link
      href={item.href}
      title={item.label}
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
