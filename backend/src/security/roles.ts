import type { AdminRole } from "./types.js";

const ROLE_WEIGHT: Record<AdminRole, number> = {
  editor: 10,
  owner: 20
};

export function hasRequiredRole(role: AdminRole, requiredRole: AdminRole): boolean {
  return ROLE_WEIGHT[role] >= ROLE_WEIGHT[requiredRole];
}
