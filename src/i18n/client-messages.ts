import "server-only"

import type { AbstractIntlMessages } from "next-intl"
import { getMessages } from "next-intl/server"

import { CLIENT_MESSAGE_SCOPES, pickMessages, type ClientMessageScope } from "./client-namespaces"

/** The messages a scope's client components read — pass to its `NextIntlClientProvider`. */
export async function clientMessages(scope: ClientMessageScope): Promise<AbstractIntlMessages> {
  const messages = (await getMessages()) as Parameters<typeof pickMessages>[0]
  return pickMessages(messages, CLIENT_MESSAGE_SCOPES[scope])
}
