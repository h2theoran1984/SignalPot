import type { AuthContext, OrgRole } from "./auth";

/**
 * Role hierarchy for permission checks.
 * Higher number = more permissions.
 */
const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 5,
  admin: 4,
  developer: 3,
  viewer: 2,
  auditor: 1,
};

/**
 * Check if the user has at least the given role in their current org.
 */
export function hasOrgRole(auth: AuthContext, minRole: OrgRole): boolean {
  if (!auth.orgId || !auth.orgRole) return false;
  return ROLE_HIERARCHY[auth.orgRole] >= ROLE_HIERARCHY[minRole];
}

/**
 * Can the user create/update an agent?
 * Personal: must be the owner.
 * Org: must be developer+ in the same org.
 */
export function canManageAgent(
  auth: AuthContext,
  agent: { owner_id: string; org_id: string | null }
): boolean {
  if (!agent.org_id) return agent.owner_id === auth.profileId;
  if (auth.orgId !== agent.org_id) return false;
  return hasOrgRole(auth, "developer");
}

/**
 * Can the user delete an agent?
 * Personal: must be the owner.
 * Org: must be admin+ in the same org.
 */
export function canDeleteAgent(
  auth: AuthContext,
  agent: { owner_id: string; org_id: string | null }
): boolean {
  if (!agent.org_id) return agent.owner_id === auth.profileId;
  if (auth.orgId !== agent.org_id) return false;
  return hasOrgRole(auth, "admin");
}

/**
 * Can the user view org-scoped data?
 */
export function canViewOrgData(auth: AuthContext): boolean {
  return auth.orgId !== null && auth.orgRole !== null;
}

/**
 * Can the user invite/remove/change role of members?
 */
export function canManageMembers(auth: AuthContext): boolean {
  return hasOrgRole(auth, "admin");
}

/**
 * Can the user manage org billing?
 */
export function canManageBilling(auth: AuthContext): boolean {
  return hasOrgRole(auth, "owner");
}

/**
 * Can the user create org-scoped API keys?
 */
export function canCreateOrgKey(auth: AuthContext): boolean {
  return hasOrgRole(auth, "developer");
}

/**
 * Can the user view the audit log?
 */
export function canViewAuditLog(auth: AuthContext): boolean {
  if (!auth.orgId || !auth.orgRole) return false;
  return ["owner", "admin", "auditor"].includes(auth.orgRole);
}
