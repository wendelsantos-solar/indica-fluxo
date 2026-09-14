import { redirect } from "next/navigation"

export default async function WorkspaceIndex({ params }: PageProps<"/[workspaceSlug]">) {
  const { workspaceSlug } = await params
  redirect(`/${workspaceSlug}/overview`)
}
