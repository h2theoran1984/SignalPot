import { cookies } from "next/headers";

const ORG_COOKIE = "sp-org-id";

/**
 * Read the current org context from the sp-org-id cookie.
 * For use in server components.
 */
export async function getOrgContext(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ORG_COOKIE)?.value ?? null;
}
