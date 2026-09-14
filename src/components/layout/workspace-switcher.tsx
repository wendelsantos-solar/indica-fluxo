"use client"

import { Check, ChevronsUpDown, Plus } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Link, useRouter } from "@/i18n/navigation"

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
  const t = useTranslations("common.workspace")
  const router = useRouter()

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-full min-w-0 items-center gap-2 rounded-control px-1.5 text-left transition-colors duration-[120ms] hover:bg-hover touch:h-10"
          aria-label={t("switchLabel", { name: current.name })}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-badge bg-inverse text-micro text-inverse-foreground">
            {initials(current.name)}
          </span>
          <span className="min-w-0 flex-1 truncate text-caption font-semibold text-foreground">
            {current.name}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownTrigger>

      <DropdownContent className="w-[232px]">
        <DropdownLabel>{t("plural")}</DropdownLabel>
        {workspaces.map((workspace) => (
          <DropdownItem
            key={workspace.id}
            onSelect={() =>
              router.push({
                pathname: "/[workspaceSlug]/overview",
                params: { workspaceSlug: workspace.slug },
              })
            }
            className="justify-between"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-badge bg-fill-strong text-micro text-foreground-secondary">
                {initials(workspace.name)}
              </span>
              <span className="truncate">{workspace.name}</span>
            </span>
            {workspace.id === current.id ? (
              <Check className="size-3.5 text-foreground" aria-hidden="true" />
            ) : null}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem asChild>
          <Link href="/onboarding">
            <Plus aria-hidden="true" />
            {t("create")}
          </Link>
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  )
}
