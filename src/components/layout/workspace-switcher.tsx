"use client"

import { Check, ChevronsUpDown, Plus } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"

import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown"
import { initials } from "@/lib/utils"

export interface WorkspaceOption {
  id: string
  name: string
  slug: string
  role: string
}

export function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: WorkspaceOption[]
  current: WorkspaceOption
}) {
  const router = useRouter()

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-[120ms] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={`Current workspace: ${current.name}. Switch workspace`}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-control bg-primary text-micro font-medium text-primary-foreground">
            {initials(current.name)}
          </span>
          <span className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">
            {current.name}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownTrigger>

      <DropdownContent className="w-[232px]">
        <DropdownLabel>Workspaces</DropdownLabel>
        {workspaces.map((workspace) => (
          <DropdownItem
            key={workspace.id}
            onSelect={() => router.push(`/${workspace.slug}/overview`)}
            className="justify-between"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-badge bg-surface-2 text-micro font-medium text-foreground-secondary">
                {initials(workspace.name)}
              </span>
              <span className="truncate">{workspace.name}</span>
            </span>
            {workspace.id === current.id ? (
              <Check className="size-3.5 text-primary" aria-hidden="true" />
            ) : null}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem asChild>
          <Link href="/onboarding">
            <Plus aria-hidden="true" />
            New workspace
          </Link>
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  )
}
