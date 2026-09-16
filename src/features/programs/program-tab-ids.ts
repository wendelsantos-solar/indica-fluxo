/**
 * The program page's tab ids. Kept out of `program-tabs.tsx`: that module is
 * `"use client"`, and a value imported from it into a Server Component is a
 * client reference, not the array — `PROGRAM_TABS.includes` would throw.
 */
export const PROGRAM_TABS = ["affiliates", "commissions", "settings"] as const
export type ProgramTab = (typeof PROGRAM_TABS)[number]
