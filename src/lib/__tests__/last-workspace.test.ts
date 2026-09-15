import { describe, expect, it } from "vitest"

import { pickReturnWorkspace } from "@/lib/last-workspace"

const workspaces = [{ slug: "acme" }, { slug: "globex" }]

describe("pickReturnWorkspace", () => {
  it("returns the remembered workspace when the reader still belongs to it", () => {
    expect(pickReturnWorkspace(workspaces, "globex")).toEqual({ slug: "globex" })
  })

  it("falls back to the first workspace for an unknown or missing slug", () => {
    expect(pickReturnWorkspace(workspaces, "revoked")).toEqual({ slug: "acme" })
    expect(pickReturnWorkspace(workspaces, undefined)).toEqual({ slug: "acme" })
  })

  it("returns null when there is no workspace", () => {
    expect(pickReturnWorkspace([], "acme")).toBeNull()
  })
})
