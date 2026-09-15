/**
 * Plan enforcement through the real services, against Postgres, as the app
 * role (`withUser`). Subscriptions are written on the service connection, as
 * the billing webhook does. Data is committed (services run their own
 * transactions) and removed in `afterAll`. Opt-in:
 *
 *   RUN_DB_TESTS=1 pnpm exec vitest run src/server/services/__tests__/plan-enforcement.db.test.ts
 */
import { config } from "dotenv"
import { and, eq, sql } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
// Never reach Supabase Auth from a test: an invitation e-mail creates a real account.
vi.mock("@/server/services/invite-mail", () => ({
  sendInviteEmail: async () => ({ emailSent: false, skipped: "notConfigured", inviteUrl: "", loginUrl: "" }),
  inviteLinksFor: () => ({ inviteUrl: "", loginUrl: "" }),
}))
config({ path: ".env.local", quiet: true })

const RUN = process.env.RUN_DB_TESTS === "1"

const { db } = await import("@/server/db")
const schema = await import("@/server/db/schema")
const { createFixtures, errorCode } = await import("./db-fixtures")
const { createProgram, updateProgram } = await import("../programs")
const { inviteAffiliate, setCustomRate, setParticipationStatus } = await import("../affiliates")
const { inviteMember, resendMemberInvite, removeMember } = await import("../workspaces")
const { listAuditLog } = await import("../audit")

const f = createFixtures("enf")

const RULE = {
  description: null,
  status: "active" as const,
  commissionType: "percentage" as const,
  commissionValue: 3000,
  commissionDurationMonths: null,
  attributionModel: "last_click" as const,
  attributionWindowDays: 60,
  commissionHoldDays: 30,
  currency: "BRL",
}
const program = (name: string, environment: "test" | "live") => ({ ...RULE, name, environment })
const affiliate = (programId: string, name: string, extra: object = {}) => ({
  programId,
  name,
  email: `${name}-${crypto.randomUUID().slice(0, 6)}@example.test`,
  ...extra,
})

describe.runIf(RUN)("plan enforcement against Postgres", () => {
  // Removes ~20 throwaway users and workspaces (one with 100 affiliates) over a
  // remote connection; a minute is not always enough.
  afterAll(async () => {
    await f.cleanup()
  }, 300_000)

  it("Sandbox: a live program needs live mode", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id)
    expect(await errorCode(createProgram(owner.id, ws, program("Live one", "live")))).toBe("LIVE_MODE_REQUIRED")
    // The one test program fits; a second does not.
    await createProgram(owner.id, ws, program("Test one", "test"))
    expect(await errorCode(createProgram(owner.id, ws, program("Test two", "test")))).toBe("PLAN_LIMIT_REACHED")
  }, 30_000)

  it("Launch: one live program, the second is refused", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id, "launch")
    await createProgram(owner.id, ws, program("Live one", "live"))
    expect(await errorCode(createProgram(owner.id, ws, program("Live two", "live")))).toBe("PLAN_LIMIT_REACHED")
  }, 30_000)

  it("archiving frees the slot; restoring re-checks it; the environment never changes", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id, "launch")
    const first = await createProgram(owner.id, ws, program("Live one", "live"))

    await updateProgram(owner.id, ws, first.id, { ...program("Live one", "live"), status: "archived" })
    await createProgram(owner.id, ws, program("Live two", "live"))
    expect(await errorCode(updateProgram(owner.id, ws, first.id, program("Live one", "live")))).toBe(
      "PLAN_LIMIT_REACHED",
    )

    expect(await errorCode(updateProgram(owner.id, ws, first.id, { ...program("Live one", "test"), status: "archived" }))).toBe(
      "validation_error",
    )
  }, 30_000)

  it("a fixed custom rate blocks a currency change", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id, "growth")
    const created = await createProgram(owner.id, ws, program("Rates", "test"))
    const [p] = await f.affiliates(ws, created.id, 1)
    await setCustomRate(owner.id, ws, p!.id, { type: "fixed", value: 5000, currency: "BRL" })
    const error = await updateProgram(owner.id, ws, created.id, { ...program("Rates", "test"), currency: "USD" }).catch(
      (e: { messageKey?: string }) => e.messageKey,
    )
    expect(error).toBe("customRatesBlockCurrencyChange")
  }, 30_000)

  it("Launch: 100 affiliates fit, the 101st is refused; rejecting frees a slot, approving again re-checks", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id, "launch")
    const programId = await f.program(ws, { environment: "live" })
    const existing = await f.affiliates(ws, programId, 99)

    await inviteAffiliate(owner.id, ws, affiliate(programId, "hundredth"), "pt-br")
    expect(await errorCode(inviteAffiliate(owner.id, ws, affiliate(programId, "extra"), "pt-br"))).toBe(
      "PLAN_LIMIT_REACHED",
    )

    await setParticipationStatus(owner.id, ws, existing[0]!.id, "suspended")
    await inviteAffiliate(owner.id, ws, affiliate(programId, "replacement"), "pt-br")
    expect(await errorCode(setParticipationStatus(owner.id, ws, existing[0]!.id, "approved"))).toBe(
      "PLAN_LIMIT_REACHED",
    )
  }, 60_000)

  it("an archived program takes no affiliates; a draft one does", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id, "growth")
    const archived = await f.program(ws, { status: "archived" })
    const draft = await f.program(ws, { status: "draft" })
    const refused = await inviteAffiliate(owner.id, ws, affiliate(archived, "late"), "pt-br").catch(
      (e: { messageKey?: string }) => e.messageKey,
    )
    expect(refused).toBe("programArchived")
    await inviteAffiliate(owner.id, ws, affiliate(draft, "early"), "pt-br")
  }, 30_000)

  it("referral codes are unique across the workspace's programs", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id, "growth")
    const a = await f.program(ws)
    const b = await f.program(ws)
    const first = await inviteAffiliate(owner.id, ws, affiliate(a, "one", { code: "same-code" }), "pt-br")
    const second = await inviteAffiliate(owner.id, ws, affiliate(b, "two", { code: "same-code" }), "pt-br")
    expect(first.code).toBe("same-code")
    expect(second.code).not.toBe("same-code")
  }, 30_000)

  it("custom rates: refused on Launch, allowed on Growth, and clearing always works", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id, "launch")
    const programId = await f.program(ws, { environment: "live" })
    const rate = { customCommissionType: "percentage" as const, customCommissionValue: 4000 }

    expect(await errorCode(inviteAffiliate(owner.id, ws, affiliate(programId, "vip", rate), "pt-br"))).toBe(
      "FEATURE_NOT_AVAILABLE",
    )
    const [p] = await f.affiliates(ws, programId, 1)
    expect(await errorCode(setCustomRate(owner.id, ws, p!.id, { type: "percentage", value: 4000 }))).toBe(
      "FEATURE_NOT_AVAILABLE",
    )

    await f.subscribe(ws, { plan: "growth" })
    await inviteAffiliate(owner.id, ws, affiliate(programId, "vip", rate), "pt-br")
    await setCustomRate(owner.id, ws, p!.id, { type: "percentage", value: 4000 })

    // Downgraded: the rate stays, can be removed, cannot be set again.
    await f.subscribe(ws, { plan: "launch" })
    await setCustomRate(owner.id, ws, p!.id, null)
    expect(await errorCode(setCustomRate(owner.id, ws, p!.id, { type: "percentage", value: 4000 }))).toBe(
      "FEATURE_NOT_AVAILABLE",
    )
  }, 30_000)

  it("Launch: two members (pending invitations count), the third is refused; an expired invitation does not count", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id, "launch")
    await inviteMember(owner.id, ws, { email: `a-${crypto.randomUUID()}@example.test`, role: "member" }, "pt-br")
    const third = `c-${crypto.randomUUID()}@example.test`
    expect(await errorCode(inviteMember(owner.id, ws, { email: third, role: "member" }, "pt-br"))).toBe(
      "PLAN_LIMIT_REACHED",
    )

    // Expire the pending one: it frees the slot, and renewing it re-checks.
    const [pending] = await db
      .update(schema.workspaceInvites)
      .set({ expiresAt: sql`now() - interval '1 day'` })
      .where(eq(schema.workspaceInvites.workspaceId, ws))
      .returning({ id: schema.workspaceInvites.id })
    await inviteMember(owner.id, ws, { email: third, role: "member" }, "pt-br")
    expect(await errorCode(resendMemberInvite(owner.id, ws, pending!.id, "pt-br"))).toBe("PLAN_LIMIT_REACHED")
  }, 30_000)

  it("Growth: ten members, the eleventh is refused", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id, "growth")
    await db.insert(schema.workspaceInvites).values(
      Array.from({ length: 9 }, (_, i) => ({ workspaceId: ws, email: `m${i}-${crypto.randomUUID()}@example.test` })),
    )
    expect(
      await errorCode(inviteMember(owner.id, ws, { email: `x-${crypto.randomUUID()}@example.test`, role: "member" }, "pt-br")),
    ).toBe("PLAN_LIMIT_REACHED")
  }, 30_000)

  it("the audit log is Growth: refused on Launch", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id, "launch")
    expect(await errorCode(listAuditLog(owner.id, ws))).toBe("FEATURE_NOT_AVAILABLE")
    await f.subscribe(ws, { plan: "growth" })
    expect(Array.isArray(await listAuditLog(owner.id, ws))).toBe(true)
  }, 30_000)

  it("past due beyond grace: creation answers SUBSCRIPTION_REQUIRED", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id)
    await f.subscribe(ws, { plan: "growth", status: "past_due", pastDueSince: new Date(Date.now() - 10 * 86_400_000) })
    expect(await errorCode(createProgram(owner.id, ws, program("Late", "test")))).toBe("SUBSCRIPTION_REQUIRED")
    expect(await errorCode(createProgram(owner.id, ws, program("Late live", "live")))).toBe("SUBSCRIPTION_REQUIRED")
  }, 30_000)

  it("two requests for the last slot: exactly one wins", async () => {
    const owner = await f.user()
    const ws = await f.workspace(owner.id, "launch")
    const results = await Promise.allSettled([
      createProgram(owner.id, ws, program("Race A", "live")),
      createProgram(owner.id, ws, program("Race B", "live")),
    ])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected")
    expect((rejected?.reason as { code?: string }).code).toBe("PLAN_LIMIT_REACHED")
  }, 30_000)

  it("anyone may leave, but not the last owner", async () => {
    const owner = await f.user()
    const admin = await f.user()
    const ws = await f.workspace(owner.id, "growth")
    await f.member(ws, admin.id, "admin")
    const members = await db
      .select({ id: schema.workspaceMembers.id, userId: schema.workspaceMembers.userId })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, ws))
    const ownerRow = members.find((m) => m.userId === owner.id)!
    const adminRow = members.find((m) => m.userId === admin.id)!

    expect(await errorCode(removeMember(owner.id, ws, ownerRow.id))).toBe("conflict")
    expect(await removeMember(admin.id, ws, adminRow.id)).toEqual({ self: true })
  }, 30_000)

  it("a plain member leaves under RLS, and the departure is audited (migration 0012)", async () => {
    const owner = await f.user()
    const plain = await f.user()
    const ws = await f.workspace(owner.id, "growth")
    await f.member(ws, plain.id, "member")
    const [row] = await db
      .select({ id: schema.workspaceMembers.id })
      .from(schema.workspaceMembers)
      .where(and(eq(schema.workspaceMembers.workspaceId, ws), eq(schema.workspaceMembers.userId, plain.id)))

    expect(await removeMember(plain.id, ws, row!.id)).toEqual({ self: true })
    const remaining = await db
      .select({ id: schema.workspaceMembers.id })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.id, row!.id))
    expect(remaining).toHaveLength(0)
    const audit = await db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.workspaceId, ws), eq(schema.auditLogs.actorUserId, plain.id)))
    expect(audit.map((a) => a.action)).toContain("member.removed")
  }, 30_000)
})
