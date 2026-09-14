import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { clientEnv } from "@/lib/env/client"

/**
 * Refreshes the auth cookie on every navigation and returns both the response
 * carrying the updated cookies and the current user, so middleware can gate
 * routes without a second round trip.
 *
 * Runs on the edge runtime with the publishable key only — never the secret
 * key. Route gating here is a convenience; RLS remains the real boundary.
 */
export async function updateSession(request: NextRequest) {
  const env = clientEnv()
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { response, user }
}
