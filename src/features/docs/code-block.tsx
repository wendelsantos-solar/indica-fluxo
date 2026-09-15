import { useTranslations } from "next-intl"
import type * as React from "react"

import { CopyButton } from "@/components/data-display/copy-button"
import { cn } from "@/lib/utils"

import { highlight, type CodeLanguage } from "./highlight"

const LANGUAGE_LABEL: Record<CodeLanguage, string> = {
  html: "HTML",
  javascript: "JavaScript",
  typescript: "TypeScript",
  json: "JSON",
  bash: "cURL",
  text: "Text",
}

/**
 * A documentation code sample: a header with the language (or file name) and
 * a copy button, then the highlighted code on its own surface. Horizontal
 * scroll lives inside the block, never on the page. Server-rendered; the copy
 * button is the only client leaf.
 */
export async function CodeBlock({
  code,
  language,
  filename,
  copy = true,
  className,
  bare = false,
}: {
  code: string
  language: CodeLanguage
  /** Shown instead of the language label when the sample belongs in a file. */
  filename?: string
  copy?: boolean
  className?: string
  /** No header or frame — for the body of a `CodeTabs` panel. */
  bare?: boolean
}) {
  const lines = await highlight(code, language)
  const id = codeId(code)
  const body = <CodeLines id={id} lines={lines} />

  if (bare) return body

  return (
    <figure className={cn("overflow-hidden rounded-panel border border-border bg-surface-2", className)}>
      <figcaption className="flex h-10 items-center justify-between gap-3 border-b border-border pl-4 pr-1.5">
        <span className="flex min-w-0 items-center gap-2 text-meta text-muted-foreground">
          {filename ? <span className="truncate font-mono text-foreground-secondary">{filename}</span> : null}
          {filename && language === "text" ? null : (
            <span className={cn(filename && "text-faint-foreground")}>{LANGUAGE_LABEL[language]}</span>
          )}
        </span>
        {copy ? <CopyCode code={code} sourceId={id} /> : null}
      </figcaption>
      {body}
    </figure>
  )
}

/**
 * A stable id per sample, derived from its content: the copy button points at
 * the code so the selection fallback (no Clipboard API) has something to select.
 */
export function codeId(code: string): string {
  let hash = 0
  for (let index = 0; index < code.length; index += 1) hash = (hash * 31 + code.charCodeAt(index)) | 0
  return `code-${(hash >>> 0).toString(36)}`
}

function CopyCode({ code, sourceId }: { code: string; sourceId: string }) {
  const t = useTranslations("docs.code")
  return <CopyButton value={code} variant="ghost" size="sm" label={t("copy")} describedBy={sourceId} />
}

function CodeLines({ id, lines }: { id?: string; lines: Awaited<ReturnType<typeof highlight>> }) {
  return (
    <pre
      id={id}
      data-slot="scrollable"
      tabIndex={0}
      className="overflow-x-auto px-4 py-3.5 font-mono text-caption leading-relaxed text-(--shiki-foreground) outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <code>
        {lines.map((line, index) => (
          <span key={index} className="block whitespace-pre">
            {line.every((token) => token.content === "") ? " " : null}
            {line.map((token, position) => (
              <span
                key={position}
                // Token colours are CSS variables from the css-variables theme,
                // so they resolve per light/dark theme (tokens.css).
                style={token.color ? ({ color: token.color } as React.CSSProperties) : undefined}
                className={cn(token.fontStyle !== undefined && token.fontStyle & 1 && "italic")}
              >
                {token.content}
              </span>
            ))}
          </span>
        ))}
      </code>
    </pre>
  )
}
