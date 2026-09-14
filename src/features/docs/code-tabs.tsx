import type * as React from "react"

import { CopyButton } from "@/components/data-display/copy-button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { CodeBlock, codeId } from "./code-block"
import type { CodeLanguage } from "./highlight"

/**
 * One sample in several languages. Only real, supported forms go in — no
 * framework tabs for SDKs that do not exist. Each panel keeps its own copy
 * button, so "Copy" always copies what is on screen.
 */
export async function CodeTabs({
  label,
  copyLabel,
  samples,
}: {
  /** Accessible name of the tab list. */
  label: string
  copyLabel: string
  samples: { id: string; title: string; language: CodeLanguage; code: string }[]
}) {
  const panels: { id: string; body: React.ReactNode }[] = await Promise.all(
    samples.map(async (sample) => ({
      id: sample.id,
      body: <CodeBlock code={sample.code} language={sample.language} bare />,
    })),
  )

  return (
    <Tabs defaultValue={samples[0]?.id} className="overflow-hidden rounded-panel border border-border bg-surface-2">
      <div className="flex h-10 items-center justify-between gap-3 border-b border-border pl-4 pr-1.5">
        <TabsList aria-label={label} className="h-full gap-4 border-0">
          {samples.map((sample) => (
            <TabsTrigger key={sample.id} value={sample.id} className="h-full text-meta after:bottom-0">
              {sample.title}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {samples.map((sample, index) => (
        <TabsContent key={sample.id} value={sample.id} className="relative outline-none">
          <div className="absolute -top-9 right-1.5">
            <CopyButton value={sample.code} variant="ghost" size="sm" label={copyLabel} describedBy={codeId(sample.code)} />
          </div>
          {panels[index]!.body}
        </TabsContent>
      ))}
    </Tabs>
  )
}
