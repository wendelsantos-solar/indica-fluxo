"use client"

import { Link2 } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * An anchored heading. On hover or focus a link icon appears; activating it
 * moves to the section and copies its URL, with the confirmation announced in
 * place (no toast). `scroll-mt` clears the sticky docs bar.
 */
export function SectionHeading({
  id,
  level,
  children,
  step,
  className,
}: {
  id: string
  level: 2 | 3
  children: string
  /** Quickstart step number, shown before the title. */
  step?: number
  className?: string
}) {
  const t = useTranslations("docs.heading")
  const [copied, setCopied] = React.useState(false)
  const Tag = level === 2 ? "h2" : "h3"

  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <Tag
      id={id}
      className={cn(
        "group flex scroll-mt-20 items-baseline gap-2.5 text-foreground",
        level === 2 ? "text-subheading" : "text-title",
        className,
      )}
    >
      {step ? (
        <span className="font-mono text-caption text-faint-foreground" aria-hidden="true">
          {String(step).padStart(2, "0")}
        </span>
      ) : null}
      <span className="text-balance">{children}</span>
      <a
        href={`#${id}`}
        aria-label={t("copyLink", { title: children })}
        onClick={() => {
          const url = `${window.location.origin}${window.location.pathname}#${id}`
          navigator.clipboard?.writeText(url).then(() => setCopied(true), () => {})
        }}
        className="inline-flex size-6 shrink-0 translate-y-0.5 items-center justify-center self-center rounded-control text-faint-foreground opacity-0 transition-opacity duration-[120ms] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100"
      >
        <Link2 className="size-3.5" aria-hidden="true" />
      </a>
      <span role="status" className="self-center text-meta font-normal text-muted-foreground">
        {copied ? t("copied") : ""}
      </span>
    </Tag>
  )
}
